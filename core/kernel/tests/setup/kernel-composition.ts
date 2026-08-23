// 独立用例也必须经过同一 composition 绑定；测试只替换 Adapter，不绕过 Ports。
import { installKernelCompositionPorts } from '../../src/composition/kernel-side-effects';

installKernelCompositionPorts();
