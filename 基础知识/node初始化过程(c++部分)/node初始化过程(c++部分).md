# node初始化过程(c++部分)

# node 初始化过程(c++部分)

## 1. 判断操作系统

node 会先判断运行环境，以 unix 为例，node 会调用`node.cc`下命名空间为`node`的`Start()`方法以初始化 node：

```c++
#ifdef _WIN32
// windows
#else
// unix
int main(int argc, char* argv[]) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  return node::Start(argc, argv);
}
#endif
```

start 方具体流程如下，我们挨个看看每一步分别做了什么：

```c++
int Start(int argc, char** argv) {
  // 初始化一个v8实例
  InitializationResult result = InitializeOncePerProcess(argc, argv);

  {
    // 初始化一个node实例
    NodeMainInstance main_instance(&params,
                                   uv_default_loop(),
                                   per_process::v8_platform.Platform(),
                                   result.args,
                                   result.exec_args,
                                   indices);
    // 运行node实例
    // 如果这个node实例停止运行了则返回退出码
    result.exit_code = main_instance.Run(env_info);
    }
  // 释放v8实例占用的资源
  TearDownOncePerProcess();
  return result.exit_code;
}
```

## 2. 初始化 v8 实例

初始化 v8 实例的时候，会先初始化 node 的 c++模块环境，再初始化一个 v8 实例：

```c++
InitializationResult InitializeOncePerProcess(int argc, char** argv) {
  return InitializeOncePerProcess(argc, argv, kDefaultInitialization);
}

InitializationResult InitializeOncePerProcess(
  int argc,
  char** argv,
  InitializationSettingsFlags flags) {

  InitializationResult result;

  // 先初始化Node环境
  {
    result.exit_code =
        InitializeNodeWithArgs(&(result.args), &(result.exec_args), &errors);
  }
  // 再初始化v8实例
  per_process::v8_platform.Initialize(
      static_cast<int>(per_process::cli_options->v8_thread_pool_size));
  if (init_flags & kInitializeV8) {
    V8::Initialize();
  }

  per_process::v8_initialized = true;

  return result;
}


```

### 2.1 初始化 node 环境

初始化 node 环境会调用`RegisterBuiltinModules()`方法：

```c++
int InitializeNodeWithArgs(std::vector<std::string>* argv,
                           std::vector<std::string>* exec_argv,
                           std::vector<std::string>* errors) {

  // 注册node内建c++模块
  binding::RegisterBuiltinModules();
}

void RegisterBuiltinModules() {
#define V(modname) _register_##modname();
  NODE_BUILTIN_MODULES(V)
#undef V
}

```

最终会调用到`node_bindings.cc`中的`NODE_BUILTIN_STANDARD_MODULES`来初始化内建的 node c++模块，这些模块最终会在 js 层中进行调用：

```c++
#define NODE_BUILTIN_STANDARD_MODULES(V)                                       \
  V(async_wrap)                                                                \
  V(block_list)                                                                \
  V(buffer)                                                                    \
  V(cares_wrap)                                                                \
  V(config)                                                                    \
  V(contextify)                                                                \
  V(credentials)                                                               \
  V(errors)                                                                    \
  V(fs)                                                                        \
  // 还有很多....

```

### 2.2 初始化 v8 实例

关于`isolate` 、`context`、`handle`、`handleScope`概念可以参考**v8 的一些概念**。

整个初始化过程比较复杂，略过 :)

## 3. 运行 node 实例

`main_instance.Run()` 会进行三个主要步骤：

-   创建 node 执行环境
-   加载 node 执行环境
-   开启 libuv 事件循环

```javascript
int NodeMainInstance::Run(const EnvSerializeInfo* env_info) {
  Locker locker(isolate_);
  Isolate::Scope isolate_scope(isolate_);
  HandleScope handle_scope(isolate_);

  int exit_code = 0;
  // 创建node执行环境
  DeleteFnPtr<Environment, FreeEnvironment> env =
      CreateMainEnvironment(&exit_code, env_info);
  CHECK_NOT_NULL(env);

  Context::Scope context_scope(env->context());
  // 调用重载函数
  Run(&exit_code, env.get());
  return exit_code;
}

void NodeMainInstance::Run(int* exit_code, Environment* env) {
  if (*exit_code == 0) {
    // 加载node环境
    LoadEnvironment(env, StartExecutionCallback{});
    // 开启libuv的事件循环
    *exit_code = SpinEventLoop(env).FromMaybe(1);
  }
 }
```

### 3.1 创建 node 执行环境

`CreateMainEnvironment`会跟新 env，并调用`RunBootstrapping()`方法：

```c++
NodeMainInstance::CreateMainEnvironment(int* exit_code,
                                        const EnvSerializeInfo* env_info) {
  // ...

  if (deserialize_mode_) {
    // ...
  } else {
    // 创建context
    context = NewContext(isolate_);
    CHECK(!context.IsEmpty());
    Context::Scope context_scope(context);
    // 更新env
    env.reset(new Environment(isolate_data_.get(),
                              context,
                              args_,
                              exec_args_,
                              nullptr,
                              EnvironmentFlags::kDefaultFlags,
                              {}));
    // 进行初始化
    if (env->RunBootstrapping().IsEmpty()) {
      return nullptr;
    }
  }
  return env;
}

```

`RunBootstrapping()`中会进行两个非常重要的操作：`BootstrapInternalLoaders()` 、`BootstrapNode()`：

```c++
MaybeLocal<Value> Environment::RunBootstrapping() {
  // 初始化loaders
  if (BootstrapInternalLoaders().IsEmpty()) {
    return MaybeLocal<Value>();
  }

  Local<Value> result;
  // 初始化node
  if (!BootstrapNode().ToLocal(&result)) {
    return MaybeLocal<Value>();
  }

  DoneBootstrapping();

  return scope.Escape(result);
}
```

### 3.2 加载 primordials.js & loaders.js

`BootstrapInternalLoaders()`借用`ExecuteBootstrapper()`方法的能力，最终会加载经过 v8 解析包装之后的`primordials.js` & `loaders.js`，详细加载的过程见**node 初始化过程(js 部分)**，下面我们来看 c++部分逻辑：

```c++
MaybeLocal<Value> Environment::BootstrapInternalLoaders() {

  // 初始化 getLinkedBinding getInternalBinding
  // 加载 primordials.js
  // 通过 ExecuteBootstrapper 来执行 internal/bootstrap/loaders.js 文件

  std::vector<Local<String>> loaders_params = {
      process_string(),
      FIXED_ONE_BYTE_STRING(isolate_, "getLinkedBinding"),
      FIXED_ONE_BYTE_STRING(isolate_, "getInternalBinding"),
      primordials_string()};
  std::vector<Local<Value>> loaders_args = {
      process_object(),
      NewFunctionTemplate(binding::GetLinkedBinding)
          ->GetFunction(context())
          .ToLocalChecked(),
      NewFunctionTemplate(binding::GetInternalBinding)
          ->GetFunction(context())
          .ToLocalChecked(),
      primordials()};

  Local<Value> loader_exports;
  if (!ExecuteBootstrapper(
           this, "internal/bootstrap/loaders", &loaders_params, &loaders_args)
           .ToLocal(&loader_exports)) {
    return MaybeLocal<Value>();
  }
  return scope.Escape(loader_exports);
}
```

### 3.3 加载 node.js

同样，在`BootstrapNode()`方法中也有类似操作：

```c++
MaybeLocal<Value> Environment::BootstrapNode() {

  // 加载 internal/bootstrap/node.js
  MaybeLocal<Value> result = ExecuteBootstrapper(
      this, "internal/bootstrap/node", &node_params, &node_args);
  // 线程初始化
  auto thread_switch_id =
      is_main_thread() ? "internal/bootstrap/switches/is_main_thread"
                       : "internal/bootstrap/switches/is_not_main_thread";
  result =
      ExecuteBootstrapper(this, thread_switch_id, &node_params, &node_args);
  // 进程初始化
  auto process_state_switch_id =
      owns_process_state()
          ? "internal/bootstrap/switches/does_own_process_state"
          : "internal/bootstrap/switches/does_not_own_process_state";
  result = ExecuteBootstrapper(
      this, process_state_switch_id, &node_params, &node_args);

  return scope.EscapeMaybe(result);
}

```

### 3.4 ExecuteBootstrapper

c++调用 js 的重要方法就是`ExecuteBootstrapper()`，虽然调用的过程非常的复杂，我们仍然能通过几段代码稍微窥视到一些重要步骤：

```c++
MaybeLocal<Value> ExecuteBootstrapper(Environment* env,
                                      const char* id,
                                      std::vector<Local<String>>* parameters,
                                      std::vector<Local<Value>>* arguments) {
  EscapableHandleScope scope(env->isolate());
  // 将指定的js文件（也就是parameters所指定的路径的js文件）进行编译
  // 编译成什么，我也不清楚 :(
  // 具体还是需要对v8有更深入的了解
  MaybeLocal<Function> maybe_fn =
      NativeModuleEnv::LookupAndCompile(env->context(), id, parameters, env);

  Local<Function> fn;

  // 通过Call方法，执行已经编译好的js方法
  MaybeLocal<Value> result = fn->Call(env->context(),
                                      Undefined(env->isolate()),
                                      arguments->size(),
                                      arguments->data());

  return scope.EscapeMaybe(result);
}

MaybeLocal<v8::Value> Function::Call(Local<Context> context,
                                     v8::Local<v8::Value> recv, int argc,
                                     v8::Local<v8::Value> argv[]) {
  // 获取到当前的isolate
  auto isolate = reinterpret_cast<i::Isolate*>(context->GetIsolate());
  // trace
  TRACE_EVENT_CALL_STATS_SCOPED(isolate, "v8", "V8.Execute");
  // 进入v8调用，传入 isolate、context、编译好的js方法、以及可能的回调函数
  ENTER_V8(isolate, context, Function, Call, MaybeLocal<Value>(),
           InternalEscapableScope);
  i::TimerEventScope<i::TimerEventExecute> timer_scope(isolate);
  auto self = Utils::OpenHandle(this);
  Utils::ApiCheck(!self.is_null(), "v8::Function::Call",
                  "Function to be called is a null pointer");
  i::Handle<i::Object> recv_obj = Utils::OpenHandle(*recv);
  STATIC_ASSERT(sizeof(v8::Local<v8::Value>) == sizeof(i::Handle<i::Object>));
  i::Handle<i::Object>* args = reinterpret_cast<i::Handle<i::Object>*>(argv);
  Local<Value> result;
  has_pending_exception = !ToLocal<Value>(
      i::Execution::Call(isolate, self, recv_obj, argc, args), &result);
  // 执行方法失败时返回
  RETURN_ON_FAILED_EXECUTION(Value);
  // 执行成功，退出调用，返回结果
  RETURN_ESCAPED(result);
}
```

### 3.5 加载 node 执行环境

当 node 执行环境创建完之后，

```c++
MaybeLocal<Value> LoadEnvironment(
    Environment* env,
    StartExecutionCallback cb) {
  // 初始化 libuv
  env->InitializeLibuv();
  env->InitializeDiagnostics();
  // 加载nodejs js 执行环境
  return StartExecution(env, cb);
}
```

同样的，`StartExecution()`会最终借用`ExecuteBootstrapper()` 解析执行 js 文件，具体过程会在 js 部分详细阐释：

```c++
MaybeLocal<Value> StartExecution(Environment* env, StartExecutionCallback cb) {

  if (cb != nullptr) {
    EscapableHandleScope scope(env->isolate());

    if (StartExecution(env, "internal/bootstrap/environment").IsEmpty())
      return {};

    StartExecutionCallbackInfo info = {
      env->process_object(),
      env->native_module_require(),
    };

    return scope.EscapeMaybe(cb(info));
  }

  if (env->worker_context() != nullptr) {
    return StartExecution(env, "internal/main/worker_thread");
  }

  std::string first_argv;
  if (env->argv().size() > 1) {
    first_argv = env->argv()[1];
  }

  if (first_argv == "inspect") {
    return StartExecution(env, "internal/main/inspect");
  }

  if (per_process::cli_options->print_help) {
    return StartExecution(env, "internal/main/print_help");
  }

  if (env->options()->prof_process) {
    return StartExecution(env, "internal/main/prof_process");
  }

  // -e/--eval without -i/--interactive
  if (env->options()->has_eval_string && !env->options()->force_repl) {
    return StartExecution(env, "internal/main/eval_string");
  }

  if (env->options()->syntax_check_only) {
    return StartExecution(env, "internal/main/check_syntax");
  }

  if (!first_argv.empty() && first_argv != "-") {
    return StartExecution(env, "internal/main/run_main_module");
  }

  if (env->options()->force_repl || uv_guess_handle(STDIN_FILENO) == UV_TTY) {
    return StartExecution(env, "internal/main/repl");
  }

  return StartExecution(env, "internal/main/eval_stdin");
}
```

### 3.6 开启 libuv 事件循环

当所有的 js 环境（内置模块、主进程、线程）都准备好之后，nodejs 会开启 libuv 事件循环，其核心逻辑是一个`do - while` 循环。

```c++
Maybe<int> SpinEventLoop(Environment* env) {

  bool more;
  do {
    // 执行一个事件循环
    uv_run(env->event_loop(), UV_RUN_DEFAULT);

    // 是否有更多的待处理事件
    more = uv_loop_alive(env->event_loop());

    // 当进程未停止，且还有更多待处理事件的时候，
    // 继续事件循环
  } while (more == true && !env->is_stopping());

  // 退出node进程
  // 最终会调用 process.emit('exit')
  return EmitProcessExit(env);
}

// uv_loop_alive 最终会调用 uv__loop_alive
// 用以获取是否还有待处理的事件
static int uv__loop_alive(const uv_loop_t* loop) {
  return uv__has_active_handles(loop) ||
         uv__has_active_reqs(loop) ||
         loop->closing_handles != NULL;
}

```

### 3.7 libuv 事件循环过程

我们看看`uv_run()`方法：

```c++
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int timeout;
  int r;
  int ran_pending;

  r = uv__loop_alive(loop);
  if (!r)
    uv__update_time(loop);
  // 如果没有待处理的事件，或者uv_stop停止了事件循环则退出
  // 否则重复该流程
  while (r != 0 && loop->stop_flag == 0) {
    uv__update_time(loop);
    uv__run_timers(loop);
    ran_pending = uv__run_pending(loop);
    uv__run_idle(loop);
    uv__run_prepare(loop);

    timeout = 0;
    if ((mode == UV_RUN_ONCE && !ran_pending) || mode == UV_RUN_DEFAULT)
      timeout = uv_backend_timeout(loop);

    uv__io_poll(loop, timeout);
    uv__metrics_update_idle_time(loop);

    uv__run_check(loop);
    uv__run_closing_handles(loop);

    if (mode == UV_RUN_ONCE) {
      uv__update_time(loop);
      uv__run_timers(loop);
    }

    r = uv__loop_alive(loop);
    if (mode == UV_RUN_ONCE || mode == UV_RUN_NOWAIT)
      break;
  }
  if (loop->stop_flag != 0)
    loop->stop_flag = 0;

  return r;
}
```

引用 libuv 官网的一张图：

![](image/loop_iteration_u0OBAcQu3n.png)

至于每一步具体做了些什么，可以参考后面的[libuv](../../libuv/libuv.md "libuv")部分，我做了比较详细的分析。

## 总结

node 初始化的过程如下：

1.  初始化一个 v8 的实例
2.  初始化`src` 下 node 所需的 c++内建模块
3.  初始化v8实例中`isolate`的`context`
4.  初始化 js 部分，参考**node 初始化过程(js 部分)**
    1.  将`primordials`代理到 js 原生方法上
    2.  加载 c++的内建模块，并提供 js 方法`internalBinding()`方法来访问这些模块
        1.  tip：为什么能用js访问c++？js代码的文本会被v8进行编译。可以认为js是c++模块的高级抽象，在转变为抽象语法树的时候，它就已经是c++对象了。
        2.  所以`internalBinding`本质上可以认为是js中的一个标记，这个标记代表着js在某处调用了c++模块，在编译的时候会被替换
    3.  初始化`require()` 方法，用于加载内建的 js 模块
    4.  初始化进程和线程
    5.  预加载一些模块
5.  开启并进入 libuv 事件循环
