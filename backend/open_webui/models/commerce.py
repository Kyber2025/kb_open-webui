"""Server-owned reseller permissions, immutable quotes, and durable transaction history."""
from sqlalchemy import BigInteger, Boolean, Column, Integer, Numeric, String, Index
from open_webui.internal.db import Base, JSONField


class ResellerAccount(Base):
    __tablename__ = 'reseller_account'
    user_id = Column(String, primary_key=True)
    invite_id = Column(String, nullable=False, unique=True)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, nullable=False)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class ResellerPrice(Base):
    __tablename__ = 'reseller_price'
    scope = Column(String, primary_key=True)  # default or registered reseller user ID
    tier_id = Column(String, primary_key=True)
    price_usd = Column(Numeric(18, 6), nullable=False)
    updated_by = Column(String, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class CommerceTransaction(Base):
    __tablename__ = 'commerce_transaction'
    id = Column(String, primary_key=True)
    source = Column(String, nullable=False)  # subscription | reseller | manual | payment
    logical_order_id = Column(String, nullable=True)
    user_id = Column(String, nullable=True, index=True)
    actor_id = Column(String, nullable=True)
    tier_id = Column(String, nullable=True)
    tier_name = Column(String, nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    duration_days = Column(Integer, nullable=True)
    unit_price = Column(Numeric(18, 6), nullable=True)
    amount = Column(Numeric(18, 6), nullable=True)  # manual issuance is not revenue
    chain_id = Column(String, nullable=True)
    status = Column(String, nullable=False)
    fulfilled = Column(Boolean, nullable=False, default=False)
    stock_backed = Column(Boolean, nullable=False, default=False)
    batch_id = Column(String, nullable=True, unique=True)
    address = Column(String, nullable=True)
    tx_hash = Column(String, nullable=True)
    paid_at = Column(BigInteger, nullable=True, index=True)
    payment = Column(JSONField, nullable=True)
    collections = Column(JSONField, nullable=True)
    note = Column(String, nullable=True)
    expires_at = Column(BigInteger, nullable=True)
    created_at = Column(BigInteger, nullable=False)
    updated_at = Column(BigInteger, nullable=False)
    synced_at = Column(BigInteger, nullable=True)
    __table_args__ = (Index('ix_commerce_source_created', 'source', 'created_at'),)


class CommerceHold(Base):
    __tablename__ = 'commerce_hold'
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False)
    tier_id = Column(String, nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    expires_at = Column(BigInteger, nullable=False)


class CommerceSync(Base):
    __tablename__ = 'commerce_sync'
    id = Column(String, primary_key=True)
    cursor = Column(BigInteger, nullable=False, default=0)
    updated_at = Column(BigInteger, nullable=False)


class CommerceNotice(Base):
    __tablename__ = 'commerce_notice'
    id = Column(String, primary_key=True)
    payload = Column(JSONField, nullable=False)
    sent = Column(Boolean, nullable=False, default=False)
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(BigInteger, nullable=False)
    created_at = Column(BigInteger, nullable=False)
    sent_at = Column(BigInteger, nullable=True)
