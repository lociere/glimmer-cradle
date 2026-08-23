"""Cognition 事实存储适配层；领域对象只通过 Repository 访问 memory.db。"""
from glimmer_cradle.cognition.adapters.persistence.memory.database import CognitionDatabase
from glimmer_cradle.cognition.adapters.persistence.memory.knowledge_repo import KnowledgeRepository
from glimmer_cradle.cognition.adapters.persistence.memory.memory_repo import MemoryRepository
from glimmer_cradle.cognition.adapters.persistence.memory.relationship_repo import RelationshipRepository
from glimmer_cradle.cognition.adapters.persistence.memory.vector_repo import VectorRepository

__all__ = [
    "CognitionDatabase",
    "MemoryRepository",
    "KnowledgeRepository",
    "RelationshipRepository",
    "VectorRepository",
]
