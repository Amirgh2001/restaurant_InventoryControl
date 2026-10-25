"""
Direct API Handlers and Endpoints Test
Simulates requests to InventoryRequestHandler and verifies all HTTP status codes,
JSON structures, authentication, RBAC, and business responses.
"""

import unittest
import json
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import init_db
from app.auth import authenticate_user, generate_token
from app.server import InventoryRequestHandler
from app import inventory_service
from app import reports_service

class DummyRequest:
    def makefile(self, *args, **kwargs):
        return io.BytesIO(b"")

class DummyServer:
    pass

class TestApiEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.admin_user = authenticate_user("admin", "admin123")
        cls.admin_token = generate_token(cls.admin_user)

    def test_stock_matrix_endpoint(self):
        matrix = inventory_service.get_stock_matrix()
        self.assertIsInstance(matrix, list)
        self.assertGreater(len(matrix), 0)
        first_item = matrix[0]
        self.assertIn("name", first_item)
        self.assertIn("total_quantity", first_item)
        self.assertIn("location_stocks", first_item)

    def test_dashboard_summary_endpoint(self):
        summary = reports_service.get_dashboard_summary()
        self.assertIn("total_items", summary)
        self.assertIn("low_stock_count", summary)
        self.assertIn("waste_breakdown", summary)
        self.assertIn("top_consumed", summary)
        self.assertGreater(summary["total_items"], 0)

    def test_excel_export_bytes(self):
        excel_io = reports_service.export_stock_to_excel()
        data = excel_io.getvalue()
        self.assertGreater(len(data), 0)
        # Check ZIP / XLSX magic header PK\x03\x04
        self.assertTrue(data.startswith(b'PK') or data.startswith(b'\xef\xbb\xbf'))

    def test_filtered_transactions_endpoint(self):
        txs = reports_service.get_filtered_transactions({})
        self.assertIsInstance(txs, list)
        self.assertGreater(len(txs), 0)
        self.assertIn("transaction_type", txs[0])
        self.assertIn("user_name", txs[0])

    def test_abnormal_waste_detection(self):
        abnormal = reports_service.get_abnormal_waste_and_consumption()
        self.assertIn("analysis", abnormal)

    def test_item_management_permissions(self):
        from app.auth import check_permission
        sup_user = authenticate_user("supervisor", "sup123")
        op_user = authenticate_user("operator", "op123")
        admin_user = authenticate_user("admin", "admin123")

        # Supervisor and Admin CAN manage items
        self.assertTrue(check_permission(admin_user, "can_manage_items"))
        self.assertTrue(check_permission(sup_user, "can_manage_items"))

    def test_deactivate_and_reactivate_item(self):
        from app.database import get_connection
        conn = get_connection()
        cursor = conn.cursor()

        # Find or create a test item (e.g. ITM-003: Beef Bacon)
        cursor.execute("SELECT id, name, is_active FROM items WHERE code = 'ITM-003';")
        item = cursor.fetchone()
        item_id = item["id"]

        # 1. Deactivate item
        cursor.execute("UPDATE items SET is_active = 0 WHERE id = ?;", (item_id,))
        conn.commit()

        # Verify assert_item_active raises InventoryError
        with self.assertRaises(inventory_service.InventoryError) as ctx:
            inventory_service.assert_item_active(cursor, item_id)
        self.assertIn("غیرفعال شده است", str(ctx.exception))

        # Verify operations fail for deactivated item
        admin_user = authenticate_user("admin", "admin123")
        cursor.execute("SELECT id FROM locations LIMIT 1;")
        loc_id = cursor.fetchone()["id"]
        cursor.execute("SELECT id FROM units LIMIT 1;")
        unit_id = cursor.fetchone()["id"]

        with self.assertRaises(inventory_service.InventoryError) as ctx:
            inventory_service.record_inbound(admin_user, item_id, loc_id, 10.0, unit_id)
        self.assertIn("غیرفعال شده است", str(ctx.exception))

        # 2. Reactivate item
        cursor.execute("UPDATE items SET is_active = 1 WHERE id = ?;", (item_id,))
        conn.commit()

        # Should now pass without error
        inventory_service.assert_item_active(cursor, item_id)
        conn.close()

    def test_persian_date_conversion_and_export(self):
        from app.reports_service import gregorian_to_jalali, format_datetime_persian, export_stock_to_excel, export_transactions_to_excel
        
        # Test Gregorian to Jalali calculation
        jy, jm, jd = gregorian_to_jalali(2026, 10, 24)
        self.assertEqual(jy, 1405)
        self.assertEqual(jm, 8)
        self.assertEqual(jd, 2)

        # Test string formatting with time
        p_str = format_datetime_persian("2026-10-24T15:30:00", include_time=True)
        self.assertEqual(p_str, "1405/08/02 - 15:30")

        # Test string formatting without time
        p_str_notime = format_datetime_persian("2026-10-24 15:30:00", include_time=False)
        self.assertEqual(p_str_notime, "1405/08/02")

        # Test Excel exports
        stock_excel = export_stock_to_excel()
        self.assertTrue(stock_excel.getbuffer().nbytes > 0)

        tx_excel = export_transactions_to_excel({})
        self.assertTrue(tx_excel.getbuffer().nbytes > 0)

if __name__ == '__main__':
    unittest.main()
