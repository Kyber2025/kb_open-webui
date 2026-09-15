"""Durable subscription grants and their resource-allocation outbox."""
from sqlalchemy import BigInteger, Boolean, Column, String, Text
from open_webui.internal.db import Base


class SubscriptionChange(Base):
    __tablename__ = 'subscription_change'
    id = Column(String, primary_key=True)
    user_id = Column(String, nullable=False, index=True)
    version = Column(BigInteger, nullable=False)
    tier_id = Column(String, nullable=False)
    expires_at = Column(BigInteger, nullable=True)
    kyber_user_id = Column(String, nullable=True)
    subscription_id = Column(String, nullable=True)
    synced = Column(Boolean, nullable=False, default=False)
    error = Column(Text, nullable=True)
    created_at = Column(BigInteger, nullable=False)
