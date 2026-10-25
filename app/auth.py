"""
Authentication and Authorization Module (RBAC and Location-based permissions)
"""

import hmac
import hashlib
import time
import json
import base64
from typing import Optional, Dict, Any, List
from .database import get_connection, hash_password

SECRET_KEY = "ctrl_mojoodi_jwt_secret_token_secure_2026"

ROLE_PERMISSIONS = {
    "admin": {
        "can_view_all_locations": True,
        "can_view_reports": True,
        "can_export_excel": True,
        "can_approve_stocktake": True,
        "can_manage_items": True,
        "can_manage_locations": True,
        "can_manage_users": True,
        "can_perform_inbound": True,
        "can_perform_transfer": True,
        "can_perform_consumption": True,
        "can_perform_waste": True,
        "can_create_stocktake": True,
        "can_view_audit_trail": True,
    },
    "supervisor": {
        "can_view_all_locations": False,
        "can_view_reports": True,
        "can_export_excel": True,
        "can_approve_stocktake": False,
        "can_manage_items": True,
        "can_manage_locations": False,
        "can_manage_users": False,
        "can_perform_inbound": True,
        "can_perform_transfer": True,
        "can_perform_consumption": True,
        "can_perform_waste": True,
        "can_create_stocktake": True,
        "can_view_audit_trail": True,
    },
    "operator": {
        "can_view_all_locations": False,
        "can_view_reports": False,
        "can_export_excel": False,
        "can_approve_stocktake": False,
        "can_manage_items": False,
        "can_manage_locations": False,
        "can_manage_users": False,
        "can_perform_inbound": True,
        "can_perform_transfer": True,
        "can_perform_consumption": True,
        "can_perform_waste": True,
        "can_create_stocktake": False,
        "can_view_audit_trail": False,
    },
    "auditor": {
        "can_view_all_locations": True,
        "can_view_reports": True,
        "can_export_excel": True,
        "can_approve_stocktake": False,
        "can_manage_items": False,
        "can_manage_locations": False,
        "can_manage_users": False,
        "can_perform_inbound": False,
        "can_perform_transfer": False,
        "can_perform_consumption": False,
        "can_perform_waste": False,
        "can_create_stocktake": True,
        "can_view_audit_trail": True,
    },
    "sysadmin": {
        "can_view_all_locations": True,
        "can_view_reports": True,
        "can_export_excel": True,
        "can_approve_stocktake": True,
        "can_manage_items": True,
        "can_manage_locations": True,
        "can_manage_users": True,
        "can_perform_inbound": True,
        "can_perform_transfer": True,
        "can_perform_consumption": True,
        "can_perform_waste": True,
        "can_create_stocktake": True,
        "can_view_audit_trail": True,
    }
}

def generate_token(user_data: Dict[str, Any], expiry_hours: int = 48) -> str:
    """Generates a secure HMAC-SHA256 signed JSON token."""
    payload = {
        "id": user_data["id"],
        "username": user_data["username"],
        "full_name": user_data["full_name"],
        "role": user_data["role"],
        "exp": int(time.time()) + (expiry_hours * 3600)
    }
    payload_bytes = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode('utf-8').rstrip('=')
    
    signature = hmac.new(SECRET_KEY.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"

def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """Verifies and decodes an HMAC token. Returns user dict or None if invalid/expired."""
    if not token or '.' not in token:
        return None
    try:
        payload_b64, signature = token.split('.', 1)
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        
        # Pad base64 if needed
        padding = '=' * (-len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        payload = json.loads(payload_bytes.decode('utf-8'))
        
        if payload.get("exp", 0) < time.time():
            return None # Expired
            
        return payload
    except Exception:
        return None

def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Validates user credentials against database."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, password_hash, full_name, role, is_active
        FROM users WHERE username = ?;
    """, (username.strip(),))
    row = cursor.fetchone()
    conn.close()

    if not row or row["is_active"] == 0:
        return None

    hashed = hash_password(password)
    if not hmac.compare_digest(hashed, row["password_hash"]):
        return None

    return {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["full_name"],
        "role": row["role"]
    }

def get_user_location_ids(user_id: int, user_role: str) -> List[int]:
    """Returns list of location IDs this user can operate in. Admin/sysadmin/auditor have all."""
    conn = get_connection()
    cursor = conn.cursor()
    
    if user_role in ("admin", "sysadmin", "auditor"):
        cursor.execute("SELECT id FROM locations WHERE is_active = 1;")
        loc_ids = [r["id"] for r in cursor.fetchall()]
    else:
        cursor.execute("SELECT location_id FROM user_location_permissions WHERE user_id = ?;", (user_id,))
        loc_ids = [r["location_id"] for r in cursor.fetchall()]
        
    conn.close()
    return loc_ids

def check_permission(user: Dict[str, Any], permission_key: str) -> bool:
    """Checks role-based permission."""
    role = user.get("role", "operator")
    perms = ROLE_PERMISSIONS.get(role, {})
    return perms.get(permission_key, False)
