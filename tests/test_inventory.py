"""
Automated Integration and Unit Tests for Inventory Management Logic
Verifies transaction integrity, negative stock prevention, unit conversion,
and stocktake discrepancy reconciliation.
"""

import unittest
import os
import sys

# Ensure project root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import init_db, get_connection
from app.auth import authenticate_user
from app import inventory_service

class TestRestaurantInventory(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        self.conn = get_connection()
        self.cursor = self.conn.cursor()

        # Admin user
        self.admin = authenticate_user("admin", "admin123")
        self.assertIsNotNone(self.admin)

        # Operator user
        self.operator = authenticate_user("operator", "op123")
        self.assertIsNotNone(self.operator)

        # Get location IDs
        self.cursor.execute("SELECT id, code FROM locations;")
        self.locs = {r["code"]: r["id"] for r in self.cursor.fetchall()}

        # Get Item ITM-001 (Beef burger mince)
        self.cursor.execute("SELECT id, base_unit_id FROM items WHERE code = 'ITM-001';")
        r = self.cursor.fetchone()
        self.burger_meat_id = r["id"]
        self.kg_unit_id = r["base_unit_id"]

        # Ensure test item is active
        self.cursor.execute("UPDATE items SET is_active = 1 WHERE id = ?;", (self.burger_meat_id,))
        self.conn.commit()

        # Get Gram unit
        self.cursor.execute("SELECT id FROM units WHERE symbol = 'g';")
        self.g_unit_id = self.cursor.fetchone()["id"]

    def tearDown(self):
        self.conn.close()

    def test_01_inbound_increases_stock(self):
        """Inbound transaction must increase target location stock level."""
        loc_id = self.locs["MAIN_COLD"]
        initial_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)

        res = inventory_service.record_inbound(
            user=self.admin,
            item_id=self.burger_meat_id,
            location_id=loc_id,
            quantity=10.0,
            unit_id=self.kg_unit_id,
            notes="تست دریافت بار گوشت"
        )
        self.assertTrue(res["success"])

        new_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)
        self.assertAlmostEqual(new_stock, initial_stock + 10.0, places=2)

    def test_02_unit_conversion_on_consumption(self):
        """Consuming 500 grams should deduct exactly 0.5 kg from stock."""
        loc_id = self.locs["PREP_LINE"]
        initial_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)

        # Ensure we have at least 1 kg in prep line
        if initial_stock < 1.0:
            inventory_service.record_inbound(self.admin, self.burger_meat_id, loc_id, 5.0, self.kg_unit_id)
            initial_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)

        res = inventory_service.record_consumption(
            user=self.operator,
            item_id=self.burger_meat_id,
            location_id=loc_id,
            quantity=500.0, # 500 grams
            unit_id=self.g_unit_id,
            notes="مصرف ۵۰۰ گرم گوشت برای تست برگر"
        )
        self.assertTrue(res["success"])

        new_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)
        self.assertAlmostEqual(new_stock, initial_stock - 0.5, places=2)

    def test_03_prevent_negative_stock(self):
        """System must strictly forbid negative stock by raising InventoryError."""
        loc_id = self.locs["PREP_LINE"]
        current_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)

        excess_qty = current_stock + 1000.0 # Way higher than available
        with self.assertRaises(inventory_service.InventoryError) as ctx:
            inventory_service.record_consumption(
                user=self.operator,
                item_id=self.burger_meat_id,
                location_id=loc_id,
                quantity=excess_qty,
                unit_id=self.kg_unit_id,
                notes="تلاش غیرمجاز برای کسر بیش از موجودی"
            )
        self.assertIn("کافی نیست", str(ctx.exception))

    def test_04_atomic_transfer(self):
        """Transfer must deduct from source and add to destination atomically."""
        src_id = self.locs["MAIN_COLD"]
        dst_id = self.locs["SERVICE_FRIDGE"]

        src_initial = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, src_id)
        dst_initial = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, dst_id)

        res = inventory_service.record_transfer(
            user=self.admin,
            item_id=self.burger_meat_id,
            from_location_id=src_id,
            to_location_id=dst_id,
            quantity=5.0,
            unit_id=self.kg_unit_id,
            notes="انتقال ۵ کیلو به یخچال سرویس"
        )
        self.assertTrue(res["success"])

        src_new = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, src_id)
        dst_new = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, dst_id)

        self.assertAlmostEqual(src_new, src_initial - 5.0, places=2)
        self.assertAlmostEqual(dst_new, dst_initial + 5.0, places=2)

    def test_05_waste_recording(self):
        """Recording waste requires valid reason and deducts stock."""
        loc_id = self.locs["SERVICE_FRIDGE"]
        initial_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)

        # Get waste reason 1
        self.cursor.execute("SELECT id FROM waste_reasons LIMIT 1;")
        reason_id = self.cursor.fetchone()["id"]

        res = inventory_service.record_waste(
            user=self.operator,
            item_id=self.burger_meat_id,
            location_id=loc_id,
            quantity=1.0,
            unit_id=self.kg_unit_id,
            reason_id=reason_id,
            reason_note="تست خرابی",
            notes="ضایعات تست"
        )
        self.assertTrue(res["success"])

        new_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)
        self.assertAlmostEqual(new_stock, initial_stock - 1.0, places=2)

    def test_06_stocktake_reconciliation_workflow(self):
        """Full cycle of stocktake: Create -> Count -> Reconcile & Adjust."""
        loc_id = self.locs["SERVICE_FRIDGE"]
        
        # 1. Create session
        sess_res = inventory_service.create_stocktake_session(
            user=self.admin,
            location_id=loc_id,
            title="انبارگردانی پایان هفته یخچال سرویس"
        )
        session_id = sess_res["session_id"]
        self.assertIsNotNone(session_id)

        # 2. Count: set burger meat to exactly 50.0 kg
        count_res = inventory_service.submit_stocktake_counts(
            user=self.admin,
            session_id=session_id,
            counts=[{"item_id": self.burger_meat_id, "counted_quantity": 50.0, "notes": "شمارش دقیق فیزیکی"}]
        )
        self.assertTrue(count_res["success"])

        # 3. Manager approves
        appr_res = inventory_service.approve_and_reconcile_stocktake(
            user=self.admin,
            session_id=session_id
        )
        self.assertTrue(appr_res["success"])

        # 4. Stock level must now precisely equal 50.0
        final_stock = inventory_service.get_current_stock(self.cursor, self.burger_meat_id, loc_id)
        self.assertAlmostEqual(final_stock, 50.0, places=2)

if __name__ == '__main__':
    unittest.main()
