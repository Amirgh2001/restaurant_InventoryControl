"""
Core Inventory Business Logic & Atomic Transactions
Enforces all business rules: prevents negative stock, handles unit conversions,
executes atomic transfers, manages stocktakes and immutable audit ledger.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from .database import get_connection
from .auth import check_permission, get_user_location_ids

class InventoryError(Exception):
    """Business rule validation or authorization error."""
    pass

def convert_quantity_to_base(conn, item_id: int, quantity: float, unit_id: int) -> Tuple[float, int]:
    """
    Converts a given quantity to the item's base unit.
    Returns (quantity_in_base_unit, base_unit_id).
    """
    cursor = conn.cursor()
    cursor.execute("SELECT base_unit_id FROM items WHERE id = ?;", (item_id,))
    row = cursor.fetchone()
    if not row:
        raise InventoryError("کالای مورد نظر در سیستم یافت نشد.")
    
    base_unit_id = row["base_unit_id"]
    if unit_id == base_unit_id:
        return float(quantity), base_unit_id

    # Check direct conversion
    cursor.execute("""
        SELECT multiplier FROM unit_conversions 
        WHERE from_unit_id = ? AND to_unit_id = ?;
    """, (unit_id, base_unit_id))
    conv = cursor.fetchone()
    if conv:
        return float(quantity) * float(conv["multiplier"]), base_unit_id

    # If no conversion rule exists, fallback or error
    raise InventoryError(f"قاعده تبدیل برای واحد انتخابی به واحد پایه تعریف نشده است.")

def get_current_stock(cursor, item_id: int, location_id: int) -> float:
    """Returns the current stock quantity for an item at a specific location."""
    cursor.execute("""
        SELECT quantity FROM stock_levels 
        WHERE item_id = ? AND location_id = ?;
    """, (item_id, location_id))
    row = cursor.fetchone()
    return float(row["quantity"]) if row else 0.0

def update_stock_level(cursor, item_id: int, location_id: int, delta: float):
    """
    Safely adjusts stock level by delta. Ensures stock doesn't drop below zero.
    """
    now = datetime.now().isoformat()
    current_qty = get_current_stock(cursor, item_id, location_id)
    new_qty = current_qty + delta

    # Prevent negative stock
    if new_qty < -0.0001:  # Allow minute floating point rounding
        cursor.execute("SELECT name FROM items WHERE id = ?;", (item_id,))
        item_name = cursor.fetchone()["name"]
        cursor.execute("SELECT name FROM locations WHERE id = ?;", (location_id,))
        loc_name = cursor.fetchone()["name"]
        raise InventoryError(
            f"موجودی کالای «{item_name}» در «{loc_name}» کافی نیست. "
            f"موجودی فعلی: {current_qty:.2f} | مقدار مورد نیاز: {abs(delta):.2f}"
        )

    cursor.execute("""
        INSERT INTO stock_levels (item_id, location_id, quantity, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id, location_id) DO UPDATE SET
            quantity = ?,
            updated_at = ?;
    """, (item_id, location_id, new_qty, now, new_qty, now))

def log_audit(cursor, user_id: int, action: str, entity: str, entity_id: Optional[int], details: str):
    """Appends to audit logs."""
    now = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?);
    """, (user_id, action, entity, entity_id, details, now))

def assert_item_active(cursor, item_id: int):
    cursor.execute("SELECT name, is_active FROM items WHERE id = ?;", (item_id,))
    row = cursor.fetchone()
    if not row:
        raise InventoryError("کالای مورد نظر یافت نشد.")
    if row["is_active"] == 0:
        raise InventoryError(f"کالای «{row['name']}» غیرفعال شده است و امکان ثبت هیچ‌گونه عملیاتی برای آن وجود ندارد.")

# ----------------- Core Operations -----------------

def record_inbound(user: Dict[str, Any], item_id: int, location_id: int, 
                   quantity: float, unit_id: int, notes: str = "", 
                   batch_number: str = "", expiry_date: str = "") -> Dict[str, Any]:
    """Records received stock (Inbound / Purchase)."""
    if not check_permission(user, "can_perform_inbound"):
        raise InventoryError("شما مجوز ثبت ورود کالا را ندارید.")
    
    allowed_locs = get_user_location_ids(user["id"], user["role"])
    if location_id not in allowed_locs:
        raise InventoryError("شما به این انبار یا مکان دسترسی مجاز ندارید.")

    if quantity <= 0:
        raise InventoryError("مقدار ورود باید بزرگتر از صفر باشد.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            assert_item_active(cursor, item_id)
            base_qty, base_unit_id = convert_quantity_to_base(conn, item_id, quantity, unit_id)
            update_stock_level(cursor, item_id, location_id, base_qty)

            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO inventory_transactions
                (transaction_type, item_id, from_location_id, to_location_id, quantity, 
                 unit_id, quantity_base, batch_number, expiry_date, notes, user_id, created_at)
                VALUES ('INBOUND', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (item_id, location_id, quantity, unit_id, base_qty, batch_number, expiry_date, notes, user["id"], now))
            
            tx_id = cursor.lastrowid
            log_audit(cursor, user["id"], "INBOUND", "inventory_transactions", tx_id, 
                      f"ورود {quantity} به مکان {location_id} (معادل {base_qty:.2f} واحد پایه)")
            
        return {"success": True, "transaction_id": tx_id, "message": "ورود کالا با موفقیت ثبت و موجودی افزایش یافت."}
    finally:
        conn.close()

def record_transfer(user: Dict[str, Any], item_id: int, from_location_id: int, 
                    to_location_id: int, quantity: float, unit_id: int, 
                    notes: str = "") -> Dict[str, Any]:
    """Records transfer of stock between two locations atomically."""
    if not check_permission(user, "can_perform_transfer"):
        raise InventoryError("شما مجوز انتقال کالا بین مکان‌ها را ندارید.")

    if from_location_id == to_location_id:
        raise InventoryError("مکان مبدأ و مقصد نمی‌توانند یکسان باشند.")

    allowed_locs = get_user_location_ids(user["id"], user["role"])
    if from_location_id not in allowed_locs:
        raise InventoryError("شما به انبار یا مکان مبدأ دسترسی مجاز ندارید.")

    if quantity <= 0:
        raise InventoryError("مقدار انتقال باید بزرگتر از صفر باشد.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            assert_item_active(cursor, item_id)
            base_qty, base_unit_id = convert_quantity_to_base(conn, item_id, quantity, unit_id)

            # Deduct from source (enforces sufficient stock)
            update_stock_level(cursor, item_id, from_location_id, -base_qty)
            # Add to destination
            update_stock_level(cursor, item_id, to_location_id, base_qty)

            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO inventory_transactions
                (transaction_type, item_id, from_location_id, to_location_id, quantity, 
                 unit_id, quantity_base, notes, user_id, created_at)
                VALUES ('TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (item_id, from_location_id, to_location_id, quantity, unit_id, base_qty, notes, user["id"], now))
            
            tx_id = cursor.lastrowid
            log_audit(cursor, user["id"], "TRANSFER", "inventory_transactions", tx_id, 
                      f"انتقال {quantity} از {from_location_id} به {to_location_id}")

        return {"success": True, "transaction_id": tx_id, "message": "انتقال بین‌بخشی با موفقیت انجام شد."}
    finally:
        conn.close()

def record_consumption(user: Dict[str, Any], item_id: int, location_id: int, 
                       quantity: float, unit_id: int, notes: str = "") -> Dict[str, Any]:
    """Records consumption of ingredients/goods in a location."""
    if not check_permission(user, "can_perform_consumption"):
        raise InventoryError("شما مجوز ثبت مصرف کالا را ندارید.")

    allowed_locs = get_user_location_ids(user["id"], user["role"])
    if location_id not in allowed_locs:
        raise InventoryError("شما به این مکان دسترسی مجاز ندارید.")

    if quantity <= 0:
        raise InventoryError("مقدار مصرف باید بزرگتر از صفر باشد.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            assert_item_active(cursor, item_id)
            base_qty, base_unit_id = convert_quantity_to_base(conn, item_id, quantity, unit_id)

            # Deduct from location
            update_stock_level(cursor, item_id, location_id, -base_qty)

            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO inventory_transactions
                (transaction_type, item_id, from_location_id, to_location_id, quantity, 
                 unit_id, quantity_base, notes, user_id, created_at)
                VALUES ('CONSUMPTION', ?, ?, NULL, ?, ?, ?, ?, ?, ?);
            """, (item_id, location_id, quantity, unit_id, base_qty, notes, user["id"], now))
            
            tx_id = cursor.lastrowid
            log_audit(cursor, user["id"], "CONSUMPTION", "inventory_transactions", tx_id, 
                      f"ثبت مصرف {quantity} در مکان {location_id}")

        return {"success": True, "transaction_id": tx_id, "message": "ثبت مصرف با موفقیت انجام و موجودی کسر گردید."}
    finally:
        conn.close()

def record_waste(user: Dict[str, Any], item_id: int, location_id: int, 
                 quantity: float, unit_id: int, reason_id: int, 
                 reason_note: str = "", notes: str = "") -> Dict[str, Any]:
    """Records waste/spoilage with mandatory reason."""
    if not check_permission(user, "can_perform_waste"):
        raise InventoryError("شما مجوز ثبت ضایعات را ندارید.")

    allowed_locs = get_user_location_ids(user["id"], user["role"])
    if location_id not in allowed_locs:
        raise InventoryError("شما به این مکان دسترسی مجاز ندارید.")

    if quantity <= 0:
        raise InventoryError("مقدار ضایعات باید بزرگتر از صفر باشد.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            assert_item_active(cursor, item_id)
            # Verify reason exists
            cursor.execute("SELECT title FROM waste_reasons WHERE id = ?;", (reason_id,))
            reason_row = cursor.fetchone()
            if not reason_row:
                raise InventoryError("دلیل ضایعات انتخاب‌شده معتبر نیست.")

            base_qty, base_unit_id = convert_quantity_to_base(conn, item_id, quantity, unit_id)

            # Deduct from location
            update_stock_level(cursor, item_id, location_id, -base_qty)

            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO inventory_transactions
                (transaction_type, item_id, from_location_id, to_location_id, quantity, 
                 unit_id, quantity_base, reason_id, reason_note, notes, user_id, created_at)
                VALUES ('WASTE', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?);
            """, (item_id, location_id, quantity, unit_id, base_qty, reason_id, reason_note, notes, user["id"], now))
            
            tx_id = cursor.lastrowid
            log_audit(cursor, user["id"], "WASTE", "inventory_transactions", tx_id, 
                      f"ثبت ضایعات {quantity} به علت «{reason_row['title']}» در مکان {location_id}")

        return {"success": True, "transaction_id": tx_id, "message": "ضایعات کالا با موفقیت ثبت و از موجودی کسر شد."}
    finally:
        conn.close()

# ----------------- Stocktake & Reconciliation -----------------

def create_stocktake_session(user: Dict[str, Any], location_id: int, title: str, notes: str = "") -> Dict[str, Any]:
    """Creates a new stocktake session for a specific location."""
    if not check_permission(user, "can_create_stocktake"):
        raise InventoryError("شما مجوز ایجاد انبارگردانی را ندارید.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute("""
                INSERT INTO stocktake_sessions (location_id, title, status, notes, created_by, created_at)
                VALUES (?, ?, 'DRAFT', ?, ?, ?);
            """, (location_id, title, notes, user["id"], now))
            session_id = cursor.lastrowid

            # Snapshot all items and current system stock
            cursor.execute("SELECT id FROM items WHERE is_active = 1;")
            items = cursor.fetchall()

            for item in items:
                sys_qty = get_current_stock(cursor, item["id"], location_id)
                cursor.execute("""
                    INSERT INTO stocktake_items (session_id, item_id, system_quantity, counted_quantity, difference)
                    VALUES (?, ?, ?, 0.0, -?);
                """, (session_id, item["id"], sys_qty, sys_qty))

            log_audit(cursor, user["id"], "CREATE_STOCKTAKE", "stocktake_sessions", session_id,
                      f"آغاز جلسه انبارگردانی «{title}» برای مکان {location_id}")

        return {"success": True, "session_id": session_id, "message": "جلسه انبارگردانی با موفقیت ایجاد شد."}
    finally:
        conn.close()

def submit_stocktake_counts(user: Dict[str, Any], session_id: int, 
                           counts: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Saves counted quantities and computes discrepancies."""
    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, location_id FROM stocktake_sessions WHERE id = ?;", (session_id,))
            session = cursor.fetchone()
            if not session:
                raise InventoryError("جلسه انبارگردانی یافت نشد.")
            if session["status"] == "APPROVED":
                raise InventoryError("این انبارگردانی قبلاً تأیید و نهایی شده است و امکان تغییر ندارد.")

            for count_entry in counts:
                item_id = count_entry["item_id"]
                counted_qty = float(count_entry["counted_quantity"])
                note = count_entry.get("notes", "")

                # Fetch fresh system quantity
                cursor.execute("""
                    SELECT system_quantity FROM stocktake_items 
                    WHERE session_id = ? AND item_id = ?;
                """, (session_id, item_id))
                row = cursor.fetchone()
                if row:
                    sys_qty = row["system_quantity"]
                    diff = counted_qty - sys_qty
                    cursor.execute("""
                        UPDATE stocktake_items 
                        SET counted_quantity = ?, difference = ?, notes = ?
                        WHERE session_id = ? AND item_id = ?;
                    """, (counted_qty, diff, note, session_id, item_id))

            cursor.execute("""
                UPDATE stocktake_sessions SET status = 'SUBMITTED' WHERE id = ?;
            """, (session_id,))

            log_audit(cursor, user["id"], "SUBMIT_STOCKTAKE", "stocktake_sessions", session_id,
                      f"شمارش اقلام جلسه انبارگردانی {session_id} ثبت شد.")

        return {"success": True, "message": "شمارش‌ها با موفقیت ثبت و مغایرت‌ها محاسبه شدند."}
    finally:
        conn.close()

def approve_and_reconcile_stocktake(user: Dict[str, Any], session_id: int) -> Dict[str, Any]:
    """
    Manager approval of stocktake session: applies discrepancy adjustments
    to real-time stock and locks the session.
    """
    if not check_permission(user, "can_approve_stocktake"):
        raise InventoryError("شما مجوز تأیید انبارگردانی و اصلاح موجودی را ندارید.")

    conn = get_connection()
    try:
        with conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, location_id, title FROM stocktake_sessions WHERE id = ?;", (session_id,))
            session = cursor.fetchone()
            if not session:
                raise InventoryError("جلسه انبارگردانی یافت نشد.")
            if session["status"] == "APPROVED":
                raise InventoryError("این جلسه قبلاً تأیید شده است.")

            location_id = session["location_id"]
            now = datetime.now().isoformat()

            # Get discrepancies
            cursor.execute("""
                SELECT si.item_id, si.system_quantity, si.counted_quantity, si.difference, i.base_unit_id, i.name
                FROM stocktake_items si
                JOIN items i ON si.item_id = i.id
                WHERE si.session_id = ?;
            """, (session_id,))
            diff_items = cursor.fetchall()

            adjusted_count = 0
            for item in diff_items:
                diff = item["difference"]
                item_id = item["item_id"]
                base_unit = item["base_unit_id"]

                if abs(diff) > 0.0001:
                    adjusted_count += 1
                    tx_type = 'ADJUSTMENT_ADD' if diff > 0 else 'ADJUSTMENT_SUB'
                    abs_diff = abs(diff)

                    # Update stock level to exact counted quantity
                    update_stock_level(cursor, item_id, location_id, diff)

                    cursor.execute("""
                        INSERT INTO inventory_transactions
                        (transaction_type, item_id, from_location_id, to_location_id, quantity,
                         unit_id, quantity_base, reference_session_id, notes, user_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """, (
                        tx_type,
                        item_id,
                        location_id if diff < 0 else None,
                        location_id if diff > 0 else None,
                        abs_diff,
                        base_unit,
                        abs_diff,
                        session_id,
                        f"اصلاح خودکار ناشی از انبارگردانی «{session['title']}» (مغایرت: {diff:+.2f})",
                        user["id"],
                        now
                    ))

            # Mark session as APPROVED
            cursor.execute("""
                UPDATE stocktake_sessions 
                SET status = 'APPROVED', approved_by = ?, approved_at = ?
                WHERE id = ?;
            """, (user["id"], now, session_id))

            log_audit(cursor, user["id"], "APPROVE_STOCKTAKE", "stocktake_sessions", session_id,
                      f"انبارگردانی تأیید شد و {adjusted_count} قلم کالا اصلاح موجودی گردید.")

        return {
            "success": True, 
            "message": f"انبارگردانی با موفقیت تأیید شد و موجودی {adjusted_count} قلم کالا با واقعیت تطبیق داده شد."
        }
    finally:
        conn.close()

# ----------------- Query / View Functions -----------------

def get_stock_matrix() -> List[Dict[str, Any]]:
    """
    Returns full stock matrix: all items with quantities in all locations,
    total stock across restaurant, units, categories, and min alert status.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, name, code FROM locations WHERE is_active = 1 ORDER BY id;")
    locations = cursor.fetchall()

    cursor.execute("""
        SELECT 
            i.id, i.name, i.code, i.min_stock_alert, i.is_quick_access, i.notes,
            c.id AS category_id, c.name AS category_name, c.icon AS category_icon,
            u.id AS unit_id, u.name AS unit_name, u.symbol AS unit_symbol
        FROM items i
        JOIN categories c ON i.category_id = c.id
        JOIN units u ON i.base_unit_id = u.id
        WHERE i.is_active = 1
        ORDER BY c.sort_order, i.name;
    """)
    items = cursor.fetchall()

    cursor.execute("SELECT item_id, location_id, quantity FROM stock_levels;")
    stock_rows = cursor.fetchall()
    stock_dict = {(r["item_id"], r["location_id"]): r["quantity"] for r in stock_rows}

    cursor.execute("SELECT item_id, location_id, min_stock FROM item_location_settings;")
    settings_rows = cursor.fetchall()
    min_settings = {(r["item_id"], r["location_id"]): r["min_stock"] for r in settings_rows}

    matrix = []
    for itm in items:
        loc_stocks = {}
        total_qty = 0.0
        has_location_alert = False

        for loc in locations:
            qty = stock_dict.get((itm["id"], loc["id"]), 0.0)
            min_lim = min_settings.get((itm["id"], loc["id"]), 0.0)
            is_low = (qty < min_lim) if min_lim > 0 else False
            if is_low:
                has_location_alert = True
            total_qty += qty
            loc_stocks[loc["id"]] = {
                "location_id": loc["id"],
                "location_name": loc["name"],
                "quantity": qty,
                "min_stock": min_lim,
                "is_low": is_low
            }

        is_overall_low = (total_qty < itm["min_stock_alert"]) if itm["min_stock_alert"] > 0 else False

        matrix.append({
            "id": itm["id"],
            "name": itm["name"],
            "code": itm["code"],
            "category_id": itm["category_id"],
            "category_name": itm["category_name"],
            "category_icon": itm["category_icon"],
            "unit_id": itm["unit_id"],
            "unit_name": itm["unit_name"],
            "unit_symbol": itm["unit_symbol"],
            "total_quantity": total_qty,
            "min_stock_alert": itm["min_stock_alert"],
            "is_quick_access": bool(itm["is_quick_access"]),
            "is_overall_low": is_overall_low,
            "has_location_alert": has_location_alert,
            "location_stocks": loc_stocks
        })

    conn.close()
    return matrix

def get_low_stock_alerts() -> List[Dict[str, Any]]:
    """Returns all items currently below their defined thresholds with deficit calculations."""
    matrix = get_stock_matrix()
    alerts = []
    for item in matrix:
        if item["is_overall_low"] or item["has_location_alert"]:
            for loc_id, loc_data in item["location_stocks"].items():
                if loc_data["is_low"]:
                    deficit = loc_data["min_stock"] - loc_data["quantity"]
                    alerts.append({
                        "item_id": item["id"],
                        "item_name": item["name"],
                        "category_name": item["category_name"],
                        "location_id": loc_id,
                        "location_name": loc_data["location_name"],
                        "current_quantity": loc_data["quantity"],
                        "min_stock": loc_data["min_stock"],
                        "deficit": deficit,
                        "unit_name": item["unit_name"]
                    })
    return alerts
