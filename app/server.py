"""
Production-grade Multi-threaded HTTP & REST API Server
Serves static SPA assets and executes JSON API endpoints.
Zero external framework dependencies - runs natively on Python 3 standard library.
"""

import sys
import os
import json
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import init_db, get_connection, hash_password
from app.auth import authenticate_user, generate_token, verify_token, check_permission, get_user_location_ids
from app import inventory_service
from app import reports_service

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class InventoryRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def _send_json(self, status_code: int, data: dict):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()
        self.wfile.write(response_bytes)

    def _send_binary(self, status_code: int, content_type: str, filename: str, data_bytes: bytes):
        self.send_response(status_code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.send_header('Content-Length', str(len(data_bytes)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def _get_auth_user(self):
        """Extracts and verifies JWT token from Authorization header or URL query."""
        auth_header = self.headers.get('Authorization', '')
        token = ""
        if auth_header.startswith('Bearer '):
            token = auth_header[7:].strip()
        
        if not token:
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            token = query.get('token', [''])[0]

        if not token:
            return None
        return verify_token(token)

    def _read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode('utf-8'))

    # ------------------ GET Requests ------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query_params = urllib.parse.parse_qs(parsed.query)

        # 1. API Endpoints
        if path.startswith('/api/'):
            # Login check doesn't need auth, but other endpoints do
            if path == '/api/auth/me':
                user = self._get_auth_user()
                if not user:
                    return self._send_json(401, {"error": "لطفاً ابتدا وارد سیستم شوید."})
                allowed_locs = get_user_location_ids(user["id"], user["role"])
                return self._send_json(200, {"user": user, "allowed_locations": allowed_locs})

            user = self._get_auth_user()
            if not user:
                return self._send_json(401, {"error": "نشست کاربری نامعتبر است یا منقضی شده است."})

            try:
                # Metadata (items, categories, locations, units, reasons)
                if path == '/api/meta':
                    conn = get_connection()
                    cursor = conn.cursor()
                    
                    # Locations (filtered by user permission if operator)
                    allowed_locs = get_user_location_ids(user["id"], user["role"])
                    cursor.execute("SELECT id, name, code, description, is_active FROM locations WHERE is_active = 1;")
                    all_locations = [dict(r) for r in cursor.fetchall()]
                    
                    user_locations = [l for l in all_locations if l["id"] in allowed_locs]

                    cursor.execute("SELECT id, name, icon, sort_order FROM categories ORDER BY sort_order;")
                    categories = [dict(r) for r in cursor.fetchall()]

                    cursor.execute("SELECT id, name, symbol, is_base FROM units;")
                    units = [dict(r) for r in cursor.fetchall()]

                    cursor.execute("SELECT id, title, description FROM waste_reasons WHERE is_active = 1;")
                    waste_reasons = [dict(r) for r in cursor.fetchall()]

                    # For managers (admin/sysadmin), include is_active flag so they can view and reactivate
                    # For operators and others, strictly only active items are exposed
                    items_condition = "1=1" if user["role"] in ("admin", "sysadmin") else "i.is_active = 1"

                    cursor.execute(f"""
                        SELECT i.id, i.name, i.code, i.category_id, i.base_unit_id, i.min_stock_alert, i.is_quick_access, i.is_active,
                               c.name AS category_name, c.icon AS category_icon, u.name AS unit_name, u.symbol AS unit_symbol
                        FROM items i
                        JOIN categories c ON i.category_id = c.id
                        JOIN units u ON i.base_unit_id = u.id
                        WHERE {items_condition}
                        ORDER BY c.sort_order, i.name;
                    """)
                    items = [dict(r) for r in cursor.fetchall()]

                    conn.close()
                    return self._send_json(200, {
                        "user": user,
                        "all_locations": all_locations,
                        "user_locations": user_locations,
                        "categories": categories,
                        "units": units,
                        "waste_reasons": waste_reasons,
                        "items": items
                    })

                # Full stock matrix
                elif path == '/api/inventory/matrix':
                    matrix = inventory_service.get_stock_matrix()
                    return self._send_json(200, {"matrix": matrix})

                # Low stock alerts
                elif path == '/api/inventory/alerts':
                    alerts = inventory_service.get_low_stock_alerts()
                    return self._send_json(200, {"alerts": alerts})

                # Dashboard KPI summary
                elif path == '/api/reports/dashboard':
                    summary = reports_service.get_dashboard_summary()
                    return self._send_json(200, summary)

                # Filtered transactions log
                elif path == '/api/reports/transactions':
                    flat_filters = {k: v[0] for k, v in query_params.items()}
                    txs = reports_service.get_filtered_transactions(flat_filters)
                    return self._send_json(200, {"transactions": txs})

                # User performance report
                elif path == '/api/reports/users':
                    users_report = reports_service.get_user_performance_report()
                    return self._send_json(200, {"users_report": users_report})

                # Abnormal waste / consumption
                elif path == '/api/reports/abnormal':
                    abnormal = reports_service.get_abnormal_waste_and_consumption()
                    return self._send_json(200, abnormal)

                # Stocktake list
                elif path == '/api/stocktake/list':
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute("""
                        SELECT ss.id, ss.title, ss.status, ss.notes, ss.created_at, ss.approved_at,
                               l.name AS location_name, uc.full_name AS creator_name, ua.full_name AS approver_name
                        FROM stocktake_sessions ss
                        JOIN locations l ON ss.location_id = l.id
                        JOIN users uc ON ss.created_by = uc.id
                        LEFT JOIN users ua ON ss.approved_by = ua.id
                        ORDER BY ss.id DESC;
                    """)
                    sessions = [dict(r) for r in cursor.fetchall()]
                    conn.close()
                    return self._send_json(200, {"sessions": sessions})

                # Stocktake session details: /api/stocktake/<id>
                elif path.startswith('/api/stocktake/'):
                    sess_id = int(path.split('/')[-1])
                    details = reports_service.get_stocktake_details(sess_id)
                    return self._send_json(200, details)

                # Export Stock Excel
                elif path == '/api/export/excel/stock':
                    if not check_permission(user, "can_export_excel"):
                        return self._send_json(403, {"error": "شما مجوز خروجی اکسل را ندارید."})
                    excel_io = reports_service.export_stock_to_excel()
                    filename = f"restaurant_stock_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
                    return self._send_binary(200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename, excel_io.getvalue())

                # Export Transactions Excel
                elif path == '/api/export/excel/transactions':
                    if not check_permission(user, "can_export_excel"):
                        return self._send_json(403, {"error": "شما مجوز خروجی اکسل را ندارید."})
                    flat_filters = {k: v[0] for k, v in query_params.items()}
                    excel_io = reports_service.export_transactions_to_excel(flat_filters)
                    filename = f"inventory_transactions_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
                    return self._send_binary(200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename, excel_io.getvalue())

                # Management lists (Users, Locations, Items)
                elif path == '/api/manage/users':
                    if user["role"] not in ("admin", "sysadmin"):
                        return self._send_json(403, {"error": "دسترسی غیرمجاز."})
                    conn = get_connection()
                    cursor = conn.cursor()
                    cursor.execute("SELECT id, username, full_name, role, is_active, created_at FROM users;")
                    users_list = [dict(r) for r in cursor.fetchall()]
                    
                    # Attach user locations
                    for u in users_list:
                        cursor.execute("SELECT location_id FROM user_location_permissions WHERE user_id = ?;", (u["id"],))
                        u["location_ids"] = [r["location_id"] for r in cursor.fetchall()]
                    conn.close()
                    return self._send_json(200, {"users": users_list})

                else:
                    return self._send_json(404, {"error": "مسیر API یافت نشد."})

            except inventory_service.InventoryError as ie:
                return self._send_json(400, {"error": str(ie)})
            except Exception as e:
                return self._send_json(500, {"error": f"خطای سیستمی: {str(e)}"})

        # 2. Static SPA routing (serve index.html for root or unknown static files)
        if path == '/' or not os.path.exists(os.path.join(STATIC_DIR, path.lstrip('/'))):
            self.path = '/index.html'
        return super().do_GET()

    # ------------------ POST Requests ------------------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json_body()

            # 1. Login Endpoint
            if path == '/api/auth/login':
                username = body.get('username', '')
                password = body.get('password', '')
                user = authenticate_user(username, password)
                if not user:
                    return self._send_json(401, {"error": "نام کاربری یا رمز عبور اشتباه است."})

                token = generate_token(user)
                allowed_locs = get_user_location_ids(user["id"], user["role"])
                return self._send_json(200, {
                    "token": token,
                    "user": user,
                    "allowed_locations": allowed_locs,
                    "message": f"خوش آمدید، {user['full_name']}."
                })

            # Check Authentication for all other POST endpoints
            user = self._get_auth_user()
            if not user:
                return self._send_json(401, {"error": "لطفاً ابتدا وارد سیستم شوید."})

            # 2. Inbound Stock
            if path == '/api/inventory/inbound':
                result = inventory_service.record_inbound(
                    user=user,
                    item_id=int(body["item_id"]),
                    location_id=int(body["location_id"]),
                    quantity=float(body["quantity"]),
                    unit_id=int(body["unit_id"]),
                    notes=body.get("notes", ""),
                    batch_number=body.get("batch_number", ""),
                    expiry_date=body.get("expiry_date", "")
                )
                return self._send_json(200, result)

            # 3. Transfer Stock
            elif path == '/api/inventory/transfer':
                result = inventory_service.record_transfer(
                    user=user,
                    item_id=int(body["item_id"]),
                    from_location_id=int(body["from_location_id"]),
                    to_location_id=int(body["to_location_id"]),
                    quantity=float(body["quantity"]),
                    unit_id=int(body["unit_id"]),
                    notes=body.get("notes", "")
                )
                return self._send_json(200, result)

            # 4. Consumption Stock
            elif path == '/api/inventory/consumption':
                result = inventory_service.record_consumption(
                    user=user,
                    item_id=int(body["item_id"]),
                    location_id=int(body["location_id"]),
                    quantity=float(body["quantity"]),
                    unit_id=int(body["unit_id"]),
                    notes=body.get("notes", "")
                )
                return self._send_json(200, result)

            # 5. Waste Stock
            elif path == '/api/inventory/waste':
                result = inventory_service.record_waste(
                    user=user,
                    item_id=int(body["item_id"]),
                    location_id=int(body["location_id"]),
                    quantity=float(body["quantity"]),
                    unit_id=int(body["unit_id"]),
                    reason_id=int(body["reason_id"]),
                    reason_note=body.get("reason_note", ""),
                    notes=body.get("notes", "")
                )
                return self._send_json(200, result)

            # 6. Create Stocktake Session
            elif path == '/api/stocktake/create':
                result = inventory_service.create_stocktake_session(
                    user=user,
                    location_id=int(body["location_id"]),
                    title=body["title"],
                    notes=body.get("notes", "")
                )
                return self._send_json(200, result)

            # 7. Submit Counts: /api/stocktake/<id>/count
            elif path.startswith('/api/stocktake/') and path.endswith('/count'):
                sess_id = int(path.split('/')[-2])
                counts = body.get("counts", [])
                result = inventory_service.submit_stocktake_counts(user, sess_id, counts)
                return self._send_json(200, result)

            # 8. Approve Stocktake: /api/stocktake/<id>/approve
            elif path.startswith('/api/stocktake/') and path.endswith('/approve'):
                sess_id = int(path.split('/')[-2])
                result = inventory_service.approve_and_reconcile_stocktake(user, sess_id)
                return self._send_json(200, result)

            # 9. Manage Items (Add / Edit)
            elif path == '/api/manage/item':
                if not check_permission(user, "can_manage_items"):
                    return self._send_json(403, {"error": "شما مجوز مدیریت کالاها را ندارید."})

                conn = get_connection()
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                item_id = body.get("id")

                if item_id: # Edit
                    cursor.execute("""
                        UPDATE items SET 
                            name = ?, code = ?, category_id = ?, base_unit_id = ?,
                            min_stock_alert = ?, is_quick_access = ?, notes = ?
                        WHERE id = ?;
                    """, (body["name"], body.get("code"), int(body["category_id"]), int(body["base_unit_id"]),
                          float(body.get("min_stock_alert", 0)), int(bool(body.get("is_quick_access", False))),
                          body.get("notes", ""), item_id))
                    msg = "کالا با موفقیت ویرایش شد."
                else: # Insert
                    cursor.execute("""
                        INSERT INTO items (name, code, category_id, base_unit_id, min_stock_alert, is_quick_access, notes, is_active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?);
                    """, (body["name"], body.get("code"), int(body["category_id"]), int(body["base_unit_id"]),
                          float(body.get("min_stock_alert", 0)), int(bool(body.get("is_quick_access", False))),
                          body.get("notes", ""), now))
                    item_id = cursor.lastrowid
                    
                    # Initialize stock levels and settings for all active locations
                    cursor.execute("SELECT id FROM locations WHERE is_active = 1;")
                    active_locs = cursor.fetchall()
                    min_stock = float(body.get("min_stock_alert", 0))
                    for loc in active_locs:
                        cursor.execute("""
                            INSERT OR IGNORE INTO stock_levels (item_id, location_id, quantity, updated_at)
                            VALUES (?, ?, 0.0, ?);
                        """, (item_id, loc["id"], now))
                        cursor.execute("""
                            INSERT OR IGNORE INTO item_location_settings (item_id, location_id, min_stock, max_stock)
                            VALUES (?, ?, ?, ?);
                        """, (item_id, loc["id"], min_stock, min_stock * 5))

                    msg = "کالای جدید با موفقیت اضافه شد."

                conn.commit()
                conn.close()
                return self._send_json(200, {"success": True, "message": msg, "item_id": item_id})

            # 10. Toggle Item Active / Deactivate (Strictly Admin / Sysadmin only)
            elif path == '/api/manage/item/toggle-active':
                if user["role"] not in ("admin", "sysadmin"):
                    return self._send_json(403, {"error": "فقط مدیر مجموعه مجاز به غیرفعال‌سازی یا فعال‌سازی کالاها است."})

                item_id = int(body.get("item_id", 0))
                new_status = 1 if body.get("is_active", True) else 0

                conn = get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT name, is_active FROM items WHERE id = ?;", (item_id,))
                row = cursor.fetchone()
                if not row:
                    conn.close()
                    return self._send_json(404, {"error": "کالای مورد نظر یافت نشد."})

                item_name = row["name"]
                cursor.execute("UPDATE items SET is_active = ? WHERE id = ?;", (new_status, item_id))
                
                now = datetime.now().isoformat()
                action_name = "فعال‌سازی مجدد" if new_status == 1 else "غیرفعال‌سازی و آرشیو"
                cursor.execute("""
                    INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
                    VALUES (?, 'TOGGLE_ITEM_ACTIVE', 'items', ?, ?, ?);
                """, (user["id"], item_id, f"{action_name} کالای «{item_name}» توسط مدیر", now))

                conn.commit()
                conn.close()

                msg = f"کالای «{item_name}» با موفقیت فعال شد." if new_status == 1 else f"کالای «{item_name}» با موفقیت غیرفعال شد و از دسترس سایر کاربران خارج گردید."
                return self._send_json(200, {"success": True, "message": msg, "is_active": new_status})

            # 11. Manage Locations (Add Location)
            elif path == '/api/manage/location':
                if not check_permission(user, "can_manage_locations"):
                    return self._send_json(403, {"error": "شما مجوز مدیریت مکان‌ها را ندارید."})

                conn = get_connection()
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                cursor.execute("""
                    INSERT INTO locations (name, code, description, is_active, created_at)
                    VALUES (?, ?, ?, 1, ?);
                """, (body["name"], body["code"].strip().upper(), body.get("description", ""), now))
                conn.commit()
                new_loc_id = cursor.lastrowid
                conn.close()
                return self._send_json(200, {"success": True, "message": "مکان جدید با موفقیت ثبت شد.", "location_id": new_loc_id})

            # 11. Manage Users (Create / Update)
            elif path == '/api/manage/user':
                if not check_permission(user, "can_manage_users"):
                    return self._send_json(403, {"error": "شما مجوز مدیریت کاربران را ندارید."})

                conn = get_connection()
                cursor = conn.cursor()
                now = datetime.now().isoformat()
                target_user_id = body.get("id")

                if target_user_id: # Update
                    if body.get("password"):
                        cursor.execute("""
                            UPDATE users SET full_name = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?;
                        """, (body["full_name"], body["role"], int(body.get("is_active", 1)), hash_password(body["password"]), target_user_id))
                    else:
                        cursor.execute("""
                            UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?;
                        """, (body["full_name"], body["role"], int(body.get("is_active", 1)), target_user_id))
                    msg = "اطلاعات کاربر به‌روزرسانی شد."
                else: # Create
                    cursor.execute("""
                        INSERT INTO users (username, password_hash, full_name, role, is_active, created_at)
                        VALUES (?, ?, ?, ?, ?, ?);
                    """, (body["username"].strip(), hash_password(body["password"]), body["full_name"], body["role"], int(body.get("is_active", 1)), now))
                    target_user_id = cursor.lastrowid
                    msg = "کاربر جدید با موفقیت ایجاد گردید."

                # Update location permissions
                cursor.execute("DELETE FROM user_location_permissions WHERE user_id = ?;", (target_user_id,))
                for loc_id in body.get("location_ids", []):
                    cursor.execute("INSERT INTO user_location_permissions (user_id, location_id) VALUES (?, ?);", (target_user_id, loc_id))

                conn.commit()
                conn.close()
                return self._send_json(200, {"success": True, "message": msg, "user_id": target_user_id})

            else:
                return self._send_json(404, {"error": "مسیر API یافت نشد."})

        except inventory_service.InventoryError as ie:
            return self._send_json(400, {"error": str(ie)})
        except Exception as e:
            return self._send_json(500, {"error": f"خطا در پردازش درخواست: {str(e)}"})

def start_server(port: int = 8080):
    init_db()
    server_address = ('0.0.0.0', port)
    httpd = ThreadedHTTPServer(server_address, InventoryRequestHandler)
    print(f"🚀 سامانه مدیریت موجودی رستوران روی پورت {port} آغاز به کار کرد.")
    print(f"🔗 آدرس دسترسی محلی: http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nسرور متوقف شد.")
        httpd.server_close()

if __name__ == '__main__':
    port = 8080
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    start_server(port)
