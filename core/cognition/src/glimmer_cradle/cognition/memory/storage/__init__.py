"""Cognition 事实存储适配层；领域对象只通过 Repository 访问 memory.db。"""
from glimmer_cradle.cognition.memory.storage.database import CognitionDatabase
from glimmer_cradle.cognition.memory.storage.knowledge_repo import KnowledgeRepository
from glimmer_cradle.cognition.memory.storage.memory_repo import MemoryRepository
from glimmer_cradle.cognition.memory.storage.relationship_repo import RelationshipRepository
from glimmer_cradle.cognition.memory.storage.vector_repo import VectorRepository

__all__ = [
    "CognitionDatabase",
    "MemoryRepository",
    "KnowledgeRepository",
    "RelationshipRepository",
    "VectorRepository",
]
