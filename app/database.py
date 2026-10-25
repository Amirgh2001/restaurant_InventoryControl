"""
Database initialization, connection manager, schema definition, and initial seeding
for the Restaurant Inventory Management System (سامانه مدیریت موجودی رستوران).
"""

import sqlite3
import os
import hashlib
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "inventory.db")

def get_connection():
    """Returns a SQLite connection configured for integrity and concurrency."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password: str, salt: str = "ctrl_mojoodi_salt_2026") -> str:
    """Hashes a password with salt."""
    return hashlib.sha256((salt + password).encode('utf-8')).hexdigest()

def init_db():
    """Creates all required tables if they don't already exist and seeds initial data."""
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL, -- admin, supervisor, operator, auditor, sysadmin
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    );
    """)

    # 2. Locations Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    );
    """)

    # 3. User Location Permissions (which locations a user is authorized to operate in)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_location_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        UNIQUE(user_id, location_id)
    );
    """)

    # 4. Categories Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        sort_order INTEGER DEFAULT 0
    );
    """)

    # 5. Units Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS units (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        is_base INTEGER DEFAULT 0
    );
    """)

    # 6. Unit Conversions Table (e.g. from 1 gram to kg = 0.001)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS unit_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        to_unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        multiplier REAL NOT NULL,
        UNIQUE(from_unit_id, to_unit_id)
    );
    """)

    # 7. Waste Reasons Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS waste_reasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1
    );
    """)

    # 8. Items Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        category_id INTEGER NOT NULL REFERENCES categories(id),
        base_unit_id INTEGER NOT NULL REFERENCES units(id),
        min_stock_alert REAL DEFAULT 0,
        is_quick_access INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # 9. Item Location Settings (Specific min/max stock thresholds per location)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS item_location_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        min_stock REAL DEFAULT 0,
        max_stock REAL DEFAULT 0,
        UNIQUE(item_id, location_id)
    );
    """)

    # 10. Stock Levels Table (Real-time current stock per item per location)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stock_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0.0,
        updated_at TEXT NOT NULL,
        UNIQUE(item_id, location_id)
    );
    """)

    # 11. Stocktake Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stocktake_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL REFERENCES locations(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, SUBMITTED, APPROVED, REJECTED
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL,
        approved_at TEXT
    );
    """)

    # 12. Stocktake Items Table (Items counted during an inventory check)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS stocktake_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
        item_id INTEGER NOT NULL REFERENCES items(id),
        system_quantity REAL NOT NULL,
        counted_quantity REAL NOT NULL,
        difference REAL NOT NULL, -- counted - system
        notes TEXT,
        UNIQUE(session_id, item_id)
    );
    """)

    # 13. Inventory Transactions (Immutable Ledger / Audit Log for all inventory operations)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS inventory_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_type TEXT NOT NULL, -- INBOUND, TRANSFER, CONSUMPTION, WASTE, ADJUSTMENT_ADD, ADJUSTMENT_SUB
        item_id INTEGER NOT NULL REFERENCES items(id),
        from_location_id INTEGER REFERENCES locations(id),
        to_location_id INTEGER REFERENCES locations(id),
        quantity REAL NOT NULL,
        unit_id INTEGER NOT NULL REFERENCES units(id),
        quantity_base REAL NOT NULL,
        reason_id INTEGER REFERENCES waste_reasons(id),
        reason_note TEXT,
        batch_number TEXT,
        expiry_date TEXT,
        reference_session_id INTEGER REFERENCES stocktake_sessions(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        notes TEXT,
        created_at TEXT NOT NULL
    );
    """)

    # 14. Audit Logs Table (General system audit trail)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT,
        created_at TEXT NOT NULL
    );
    """)

    conn.commit()
    seed_initial_data(conn)
    conn.close()

def seed_initial_data(conn):
    """Populates essential restaurant starter data if empty."""
    cursor = conn.cursor()

    # Check if already seeded
    cursor.execute("SELECT COUNT(*) FROM locations;")
    if cursor.fetchone()[0] > 0:
        return

    now = datetime.now().isoformat()

    # 1. Locations
    locations = [
        ("سردخانه یا انبار اصلی", "MAIN_COLD", "انبار اصلی نگهداری اقلام منجمد و فاسدنشدنی با ظرفیت بالا", 1),
        ("یخچال انبار در مجموعه سرویس‌دهی", "SERVICE_FRIDGE", "یخچال آماده‌به‌سرویس جهت دسترسی سریع کارکنان سرویس‌دهی", 1),
        ("لاین آماده‌سازی و تولید محصولات", "PREP_LINE", "خط آماده‌سازی غذا، برگر، سرخ‌کن و پخت آشپزخانه", 1)
    ]
    cursor.executemany("INSERT INTO locations (name, code, description, is_active, created_at) VALUES (?, ?, ?, ?, ?)",
                       [(name, code, desc, active, now) for name, code, desc, active in locations])

    # 2. Units
    units = [
        ("کیلوگرم", "kg", 1),
        ("گرم", "g", 0),
        ("لیتر", "lit", 1),
        ("میلی‌لیتر", "ml", 0),
        ("عدد", "pcs", 1),
        ("بسته", "pack", 0),
        ("کارتن", "box", 0)
    ]
    cursor.executemany("INSERT INTO units (name, symbol, is_base) VALUES (?, ?, ?)", units)

    # Unit conversions:
    # 1 kg = 1000 g -> from g to kg: 0.001
    cursor.execute("SELECT id, symbol FROM units;")
    unit_map = {row["symbol"]: row["id"] for row in cursor.fetchall()}

    conversions = [
        (unit_map["g"], unit_map["kg"], 0.001),
        (unit_map["kg"], unit_map["g"], 1000.0),
        (unit_map["ml"], unit_map["lit"], 0.001),
        (unit_map["lit"], unit_map["ml"], 1000.0),
    ]
    cursor.executemany("INSERT INTO unit_conversions (from_unit_id, to_unit_id, multiplier) VALUES (?, ?, ?)", conversions)

    # 3. Categories
    categories = [
        ("پروتئین و گوشت", "🥩", 1),
        ("لبنیات و پنیرها", "🧀", 2),
        ("صیفی‌جات و سبزیجات", "🥬", 3),
        ("نان و غلات", "🍞", 4),
        ("سس‌ها و ادویه‌جات", "🧂", 5),
        ("روغن و مواد سرخ‌کردنی", "🛢️", 6),
        ("نوشیدنی‌ها", "🥤", 7),
        ("ظروف و بسته‌بندی", "📦", 8)
    ]
    cursor.executemany("INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)", categories)

    # 4. Waste Reasons
    waste_reasons = [
        ("فساد و بوی نامطبوع", "فساد ناشی از پایان عمر مفید یا نقص برودت"),
        ("انقضای تاریخ مصرف", "گذشتن تاریخ مصرف درج شده روی کالا"),
        ("خطای پخت و سوختگی", "سوختن در گریل یا خطای اپراتور هنگام طبخ"),
        ("آسیب فیزیکی و ریختن", "افتادن از دست پرسنل، شکستگی یا واژگونی ظرف"),
        ("افت کیفیت و عدم تایید سرآشپز", "کیفیت نامطلوب بافت، طعم یا بوی نامناسب قبل از پخت")
    ]
    cursor.executemany("INSERT INTO waste_reasons (title, description, is_active) VALUES (?, ?, 1)", waste_reasons)

    # 5. Users
    users = [
        ("admin", hash_password("admin123"), "مدیر مجموعه (آقای رضایی)", "admin", now),
        ("supervisor", hash_password("sup123"), "سرپرست شیفت (مهدی کاظمی)", "supervisor", now),
        ("operator", hash_password("op123"), "اپراتور آماده‌سازی (علی باقری)", "operator", now),
        ("auditor", hash_password("audit123"), "کارشناس انبارگردانی (سعید صادقی)", "auditor", now),
        ("sysadmin", hash_password("sys123"), "مدیر فناوری و سیستم (پشتیبان)", "sysadmin", now)
    ]
    cursor.executemany("INSERT INTO users (username, password_hash, full_name, role, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)", users)

    # Assign location permissions to supervisor and operator
    cursor.execute("SELECT id FROM users WHERE username = 'operator';")
    op_id = cursor.fetchone()[0]
    cursor.execute("SELECT id FROM users WHERE username = 'supervisor';")
    sup_id = cursor.fetchone()[0]

    cursor.execute("SELECT id, code FROM locations;")
    loc_rows = cursor.fetchall()
    loc_map = {row["code"]: row["id"] for row in loc_rows}

    # Operator gets access to PREP_LINE and SERVICE_FRIDGE
    cursor.execute("INSERT INTO user_location_permissions (user_id, location_id) VALUES (?, ?)", (op_id, loc_map["PREP_LINE"]))
    cursor.execute("INSERT INTO user_location_permissions (user_id, location_id) VALUES (?, ?)", (op_id, loc_map["SERVICE_FRIDGE"]))

    # Supervisor gets access to all 3
    for lid in loc_map.values():
        cursor.execute("INSERT INTO user_location_permissions (user_id, location_id) VALUES (?, ?)", (sup_id, lid))

    # 6. Items (Realistic Restaurant Ingredients)
    cursor.execute("SELECT id, name FROM categories;")
    cat_map = {row["name"]: row["id"] for row in cursor.fetchall()}

    items_data = [
        # name, code, category, unit, min_stock_alert, is_quick_access, notes
        ("گوشت چرخ‌کرده برگر (مخلوط)", "ITM-001", cat_map["پروتئین و گوشت"], unit_map["kg"], 25.0, 1, "آماده‌سازی روزانه برگر دست‌ساز"),
        ("فیله سینه مرغ زعفرانی", "ITM-002", cat_map["پروتئین و گوشت"], unit_map["kg"], 15.0, 1, "فیله مرغ استیک و سالاد سزار"),
        ("بیکن گوساله ۹۰٪", "ITM-003", cat_map["پروتئین و گوشت"], unit_map["kg"], 10.0, 0, "مورد مصرف در برگر بیکن"),
        ("پنیر چدار ورقه‌ای", "ITM-004", cat_map["لبنیات و پنیرها"], unit_map["pcs"], 150.0, 1, "ورقه‌های چدار برگر"),
        ("پنیر موزارلا قالبی مطهر", "ITM-005", cat_map["لبنیات و پنیرها"], unit_map["kg"], 20.0, 0, "برای پیتزا و پیش‌غذاها"),
        ("کره حیوانی پاستوریزه", "ITM-006", cat_map["لبنیات و پنیرها"], unit_map["kg"], 8.0, 0, "تفت دادن نان و سس‌ها"),
        ("سیب‌زمینی نیمه‌آماده منجمد (فرنچ فرایز)", "ITM-007", cat_map["روغن و مواد سرخ‌کردنی"], unit_map["kg"], 50.0, 1, "سیب‌زمینی سرخ‌کرده ۹ میل"),
        ("روغن سرخ‌کردنی شفاف ۱۶ لیتری", "ITM-008", cat_map["روغن و مواد سرخ‌کردنی"], unit_map["lit"], 40.0, 1, "سرخ‌کن لاین تولید"),
        ("نان برگر کنجدی اعلا", "ITM-009", cat_map["نان و غلات"], unit_map["pcs"], 100.0, 1, "پخت تازه روزانه نان برگر"),
        ("نان تورتیلا مکزیکی", "ITM-010", cat_map["نان و غلات"], unit_map["pcs"], 60.0, 0, "برای تاکو و بوریتو"),
        ("گوجه فرنگی گلخانه‌ای", "ITM-011", cat_map["صیفی‌جات و سبزیجات"], unit_map["kg"], 20.0, 1, "برش حلقه‌ای برای برگر و ساندویچ"),
        ("کاهو پیچ فرانسوی / رسمی", "ITM-012", cat_map["صیفی‌جات و سبزیجات"], unit_map["kg"], 15.0, 1, "شستشو و ضدعفونی شده"),
        ("پیاز قرمز خرد شده", "ITM-013", cat_map["صیفی‌جات و سبزیجات"], unit_map["kg"], 12.0, 1, "پیاز کاراملی و خام برگر"),
        ("خیارشور قلمی سوپرویژه", "ITM-014", cat_map["صیفی‌جات و سبزیجات"], unit_map["kg"], 15.0, 0, "خیارشور خرد شده برگر"),
        ("سس باربیکیو دودی کاله", "ITM-015", cat_map["سس‌ها و ادویه‌جات"], unit_map["kg"], 10.0, 1, "سس مخصوص برگر اسموکی"),
        ("سس مایونز چیلی تند", "ITM-016", cat_map["سس‌ها و ادویه‌جات"], unit_map["kg"], 10.0, 0, "سس لاین سوخاری"),
        ("نوشابه قوطی ۳۳۰ میل کوکاکولا", "ITM-017", cat_map["نوشیدنی‌ها"], unit_map["pcs"], 80.0, 1, "سرویس یخچال نوشیدنی"),
        ("آب معدنی کوچک ۵۰۰ میل", "ITM-018", cat_map["نوشیدنی‌ها"], unit_map["pcs"], 60.0, 0, "سرویس نوشیدنی"),
        ("جعبه برگر اختصاصی کرافت", "ITM-019", cat_map["ظروف و بسته‌بندی"], unit_map["pcs"], 200.0, 1, "بسته‌بندی ارسال بیرون‌بر"),
        ("پاکت بیرون‌بر کاغذی دسته دار", "ITM-020", cat_map["ظروف و بسته‌بندی"], unit_map["pcs"], 150.0, 0, "دلیوری بیرون‌بر")
    ]

    for item in items_data:
        cursor.execute("""
        INSERT INTO items (name, code, category_id, base_unit_id, min_stock_alert, is_quick_access, is_active, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        """, (item[0], item[1], item[2], item[3], item[4], item[5], item[6], now))

    # 7. Seed Initial Stocks across 3 locations
    cursor.execute("SELECT id, code FROM items;")
    item_rows = cursor.fetchall()
    item_dict = {row["code"]: row["id"] for row in item_rows}

    # Initial distributions
    # MAIN_COLD (Bulk reserves)
    # SERVICE_FRIDGE (Intermediate daily fridge)
    # PREP_LINE (Immediate prep production)
    initial_stocks = [
        # (item_code, location_code, qty, min_limit)
        ("ITM-001", "MAIN_COLD", 65.0, 30.0),
        ("ITM-001", "SERVICE_FRIDGE", 18.0, 10.0),
        ("ITM-001", "PREP_LINE", 8.5, 5.0), # Alert check: slightly low

        ("ITM-002", "MAIN_COLD", 40.0, 20.0),
        ("ITM-002", "SERVICE_FRIDGE", 12.0, 8.0),
        ("ITM-002", "PREP_LINE", 4.0, 6.0), # BELOW MINIMUM! (Alert demo)

        ("ITM-003", "MAIN_COLD", 22.0, 10.0),
        ("ITM-003", "SERVICE_FRIDGE", 6.0, 4.0),
        ("ITM-003", "PREP_LINE", 2.5, 2.0),

        ("ITM-004", "MAIN_COLD", 400.0, 200.0),
        ("ITM-004", "SERVICE_FRIDGE", 120.0, 80.0),
        ("ITM-004", "PREP_LINE", 45.0, 50.0), # BELOW MINIMUM!

        ("ITM-005", "MAIN_COLD", 45.0, 20.0),
        ("ITM-005", "SERVICE_FRIDGE", 15.0, 10.0),
        ("ITM-005", "PREP_LINE", 6.0, 5.0),

        ("ITM-006", "MAIN_COLD", 20.0, 10.0),
        ("ITM-006", "SERVICE_FRIDGE", 5.0, 3.0),
        ("ITM-006", "PREP_LINE", 2.0, 1.5),

        ("ITM-007", "MAIN_COLD", 120.0, 60.0),
        ("ITM-007", "SERVICE_FRIDGE", 35.0, 20.0),
        ("ITM-007", "PREP_LINE", 12.0, 15.0), # BELOW MINIMUM!

        ("ITM-008", "MAIN_COLD", 80.0, 40.0),
        ("ITM-008", "PREP_LINE", 24.0, 20.0),

        ("ITM-009", "MAIN_COLD", 250.0, 100.0),
        ("ITM-009", "PREP_LINE", 60.0, 50.0),

        ("ITM-010", "MAIN_COLD", 120.0, 50.0),
        ("ITM-010", "PREP_LINE", 30.0, 20.0),

        ("ITM-011", "MAIN_COLD", 35.0, 15.0),
        ("ITM-011", "SERVICE_FRIDGE", 10.0, 8.0),
        ("ITM-011", "PREP_LINE", 4.5, 5.0), # BELOW MINIMUM!

        ("ITM-012", "MAIN_COLD", 28.0, 15.0),
        ("ITM-012", "SERVICE_FRIDGE", 8.0, 6.0),
        ("ITM-012", "PREP_LINE", 3.0, 4.0), # BELOW MINIMUM!

        ("ITM-013", "MAIN_COLD", 25.0, 10.0),
        ("ITM-013", "SERVICE_FRIDGE", 8.0, 5.0),
        ("ITM-013", "PREP_LINE", 3.5, 3.0),

        ("ITM-014", "MAIN_COLD", 30.0, 15.0),
        ("ITM-014", "SERVICE_FRIDGE", 10.0, 5.0),
        ("ITM-014", "PREP_LINE", 4.0, 3.0),

        ("ITM-015", "MAIN_COLD", 24.0, 12.0),
        ("ITM-015", "SERVICE_FRIDGE", 6.0, 4.0),
        ("ITM-015", "PREP_LINE", 3.0, 2.0),

        ("ITM-016", "MAIN_COLD", 20.0, 10.0),
        ("ITM-016", "SERVICE_FRIDGE", 5.0, 3.0),
        ("ITM-016", "PREP_LINE", 2.5, 2.0),

        ("ITM-017", "MAIN_COLD", 240.0, 100.0),
        ("ITM-017", "SERVICE_FRIDGE", 48.0, 30.0),

        ("ITM-018", "MAIN_COLD", 180.0, 80.0),
        ("ITM-018", "SERVICE_FRIDGE", 36.0, 24.0),

        ("ITM-019", "MAIN_COLD", 600.0, 250.0),
        ("ITM-019", "PREP_LINE", 120.0, 80.0),

        ("ITM-020", "MAIN_COLD", 500.0, 200.0),
        ("ITM-020", "PREP_LINE", 80.0, 60.0)
    ]

    for item_code, loc_code, qty, min_limit in initial_stocks:
        item_id = item_dict[item_code]
        loc_id = loc_map[loc_code]

        cursor.execute("""
        INSERT INTO stock_levels (item_id, location_id, quantity, updated_at)
        VALUES (?, ?, ?, ?)
        """, (item_id, loc_id, qty, now))

        cursor.execute("""
        INSERT INTO item_location_settings (item_id, location_id, min_stock, max_stock)
        VALUES (?, ?, ?, ?)
        """, (item_id, loc_id, min_limit, min_limit * 5))

    # 8. Seed some initial recent transactions so reports and charts have vivid data
    cursor.execute("SELECT id FROM users WHERE username = 'admin';")
    admin_id = cursor.fetchone()[0]

    sample_txs = [
        ("INBOUND", item_dict["ITM-001"], None, loc_map["MAIN_COLD"], 50.0, unit_map["kg"], 50.0, None, None, "ورود فاکتور شماره ۱۰۴۲ از کشتارگاه مهیا پروتئین", now),
        ("TRANSFER", item_dict["ITM-001"], loc_map["MAIN_COLD"], loc_map["SERVICE_FRIDGE"], 15.0, unit_map["kg"], 15.0, None, None, "انتقال شارژ شیفت ظهر به یخچال سرویس", now),
        ("TRANSFER", item_dict["ITM-001"], loc_map["SERVICE_FRIDGE"], loc_map["PREP_LINE"], 8.0, unit_map["kg"], 8.0, None, None, "تأمین گوشت برگر لاین آماده‌سازی", now),
        ("CONSUMPTION", item_dict["ITM-001"], loc_map["PREP_LINE"], None, 14.5, unit_map["kg"], 14.5, None, None, "مصرف شیفت ناهار - پخت ۸۵ پرس برگر کلاسیک", now),
        ("WASTE", item_dict["ITM-001"], loc_map["PREP_LINE"], None, 0.8, unit_map["kg"], 0.8, 3, "سوختن دو تکه گوشت در گریل برگر به دلیل خطای تایمر", "خطای طبخ", now),
        ("WASTE", item_dict["ITM-011"], loc_map["SERVICE_FRIDGE"], None, 1.5, unit_map["kg"], 1.5, 1, "له‌شدگی و ترشیدگی بخشی از گوجه‌های سبد زیرین", "خرابی و فساد", now),
        ("CONSUMPTION", item_dict["ITM-009"], loc_map["PREP_LINE"], None, 85.0, unit_map["pcs"], 85.0, None, None, "مصرف نان برگر شیفت ناهار", now),
        ("CONSUMPTION", item_dict["ITM-007"], loc_map["PREP_LINE"], None, 22.0, unit_map["kg"], 22.0, None, None, "سرخ کردن سیب‌زمینی سرویس ناهار", now),
        ("WASTE", item_dict["ITM-007"], loc_map["PREP_LINE"], None, 1.2, unit_map["kg"], 1.2, 4, "ریختن یک ظرف سیب‌زمینی خلال خام روی کف آشپزخانه", "ریختگی کف", now)
    ]

    for tx in sample_txs:
        cursor.execute("""
        INSERT INTO inventory_transactions
        (transaction_type, item_id, from_location_id, to_location_id, quantity, unit_id, quantity_base, reason_id, reason_note, notes, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (tx[0], tx[1], tx[2], tx[3], tx[4], tx[5], tx[6], tx[7], tx[8], tx[9], admin_id, tx[10]))

    conn.commit()
    print("Database schema created and initial restaurant inventory seeded successfully!")

if __name__ == "__main__":
    init_db()
