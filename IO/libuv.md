# libuv

## 架构

libuv是一个异步I/O的跨平台c库，主要用于nodejs中。libuv架构如下：

![image-20230220183448342](assets/image-20230220183448342.png)

libuv提供了以下封装：

1. 异步的网络I/O
2. 异步的文件操作
3. 异步的DNS处理
4. 线程池
5. 基于epoll、kqueue、IOPC的I/O（事件）循环

## epoll

epoll是一种I/O事件通知机制，是linux 内核实现I/O多路复用的一个实现。相比较select、poll采用轮询的方式来检查文件描述符是否处于就绪态，epoll采用回调机制。结果就是，随着fd的增加，select和poll的效率会线性降低，而epoll不会受到太大影响，除非活跃的socket很多。

![img](assets/v2-14e0536d872474b0851b62572b732e39_1440w.webp)
