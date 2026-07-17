"""Provider 基类 + 5 个 stub 的接口契约测试（阶段 5.2）。"""
import pytest

from glimmer_cradle.cognition.cycle.providers import (
    ALL_PROVIDER_CLASSES,
    AffectProvider,
    DriveProvider,
    MemoryProvider,
    PerceptionProvider,
    Provider,
    SocialProvider,
)


def test_all_provider_classes_subclass_provider() -> None:
    for cls in ALL_PROVIDER_CLASSES:
        assert issubclass(cls, Provider)


def test_all_provider_names_align_with_source_enum() -> None:
    """provider.name 必须与 WorkspaceItem.source 枚举一一对应。"""
    names = {cls.name for cls in ALL_PROVIDER_CLASSES}
    expected = {"perception", "affect", "memory", "drive", "social"}
    assert names == expected


def test_all_provider_classes_unique() -> None:
    """五个 provider 类各自独立。"""
    cls_set = set(ALL_PROVIDER_CLASSES)
    assert len(cls_set) == 5


def test_all_providers_implemented() -> None:
    """5 个 provider 全部实化（阶段 5.6a/b/c 累计完成）。

    各自的行为测试在专项文件：
    - AffectProvider / MemoryProvider:  test_cognition_providers_56a
    - DriveProvider / SocialProvider:   test_cognition_providers_56b
    - PerceptionProvider:               test_cognition_perception
    本文件只验证它们都能 subclass Provider + 注册到 ALL_PROVIDER_CLASSES。
    """
    for cls in ALL_PROVIDER_CLASSES:
        assert issubclass(cls, Provider)


def test_provider_is_abstract() -> None:
    """直接实例化 Provider 基类应失败（含 abstract 方法）。"""
    with pytest.raises(TypeError):
        Provider()  # type: ignore[abstract]


def test_provider_class_list_order() -> None:
    """ALL_PROVIDER_CLASSES 与 __init__ 列表对齐。"""
    assert ALL_PROVIDER_CLASSES == (
        PerceptionProvider,
        AffectProvider,
        MemoryProvider,
        DriveProvider,
        SocialProvider,
    )
