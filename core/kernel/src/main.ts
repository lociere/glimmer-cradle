/**
 * 内核唯一启动入口
 * 应用启动的根文件，处理信号监听、异常捕获、优雅停机
 */
import { App } from "./app";
import { getLogger } from "./foundation/logger/logger";

const logger = getLogger("main");

/**
 * 主函数
 */
async function main() {
  const app = App.instance;

  // 注册全局异常捕获
  process.on("uncaughtException", (error) => {
    logger.critical("未捕获的异常", {
      error: error.message,
      stack: error.stack,
    });
    console.error("未捕获的异常，应用即将停止", error);
    app.stop(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.critical("未处理的Promise拒绝", {
      reason,
      promise: promise.toString(),
    });
    console.error("未处理的Promise拒绝", reason);
  });

  // 注册系统信号监听，实现优雅停机
  process.on("SIGINT", async () => {
    logger.info("收到SIGINT信号，开始优雅停机");
    await app.stop(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("收到SIGTERM信号，开始优雅停机");
    await app.stop(0);
  });

  // 启动应用
  try {
    await app.start();
  } catch (error) {
    console.error("应用启动失败", error);
    process.exit(1);
  }
}

// 启动主函数
main().catch((error) => {
  console.error("主函数执行异常", error);
  process.exit(1);
});
