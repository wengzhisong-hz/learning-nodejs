# c++插件

## 加载c++插件

nodejs c++插件是用c++编写的动态链接库。

nodejs通过`require()`函数将插件加载为普通的nodejs模块：

```js
// Native extension for .node
Module._extensions['.node'] = function(module, filename) {
  if (policy?.manifest) {
    const content = fs.readFileSync(filename);
    const moduleURL = pathToFileURL(filename);
    policy.manifest.assertIntegrity(moduleURL, content);
  }
  // Be aware this doesn't use `content`
  return process.dlopen(module, path.toNamespacedPath(filename));
};
```

而`process.dlopen`则是nodejs的bootstrap阶段初始化的：

```js
const rawMethods = internalBinding('process_methods');

{
  process.dlopen = rawMethods.dlopen;
  
  // 初始化其他方法...
}
```

在`InitializeProcessMethods`方法中，将`binding::DLOpen`绑定到了process的`dlopen`方法上:

```c++
static void InitializeProcessMethods(Local<Object> target,
                                     Local<Value> unused,
                                     Local<Context> context,
                                     void* priv) {
  Environment* env = Environment::GetCurrent(context);
  
  env->SetMethod(target, "dlopen", binding::DLOpen);
}
```

最后，我们可以在`node_binding.cc`通过`DLOpen`看到nodejs是如何加载c++插件的：



```c++
void DLOpen(const FunctionCallbackInfo<Value>& args) {
  
  // FunctionCallbackInfo<> 用于描述callback的上下文信息
  // .node模块作为参数传入DLOpen
  
  Environment* env = Environment::GetCurrent(args);
  auto context = env->context();

  Local<Object> module;
  Local<Object> exports;
  Local<Value> exports_v;
  
  if (
      // ToObject 用于生成js url对象
    	// 此处生成了名为 module 的 js url
      !args[0]->ToObject(context).ToLocal(&module) ||
      
      // 生成module的exports
      !module->Get(context, env->exports_string()).ToLocal(&exports_v) ||
    
      !exports_v->ToObject(context).ToLocal(&exports)) {
    return;
  }

  node::Utf8Value filename(env->isolate(), args[1]);
  
  // 加载插件
  // DLib 类通过libuv的uv_dlopen方法加载动态链接库
  env->TryLoadAddon(*filename, flags, [&](DLib* dlib) {
    static Mutex dlib_load_mutex;
    Mutex::ScopedLock lock(dlib_load_mutex);
		
    
    // 此处调用了最终 uv_dlopen()加载链接库
    // 加载结果会存储到 dlib->handle_中
    const bool is_opened = dlib->Open();

    // 从当前线程获取待处理的插件信息
    // mp为node_module类型
    // node_module 如下：
    //    struct node_module {
    //      int nm_version;
    //      unsigned int nm_flags;
    //      void* nm_dso_handle;
    //      const char* nm_filename;
    //      node::addon_register_func nm_register_func;
    //      node::addon_context_register_func nm_context_register_func;
    //      const char* nm_modname;
    //      void* nm_priv;
    //      struct node_module* nm_link;
    //    };
    node_module* mp = thread_local_modpending;
    thread_local_modpending = nullptr;

    

    if (mp != nullptr) {
      mp->nm_dso_handle = dlib->handle_;
      // 将mp存储到全局模块的map中
      dlib->SaveInGlobalHandleMap(mp);
    }

		// napi方式注册的插件
    if ((mp->nm_version != -1) && (mp->nm_version != NODE_MODULE_VERSION)) {
      
      if (auto callback = GetInitializerCallback(dlib)) {
        callback(exports, module, context);
        return true;
      }
    }

    Mutex::ScopedUnlock unlock(lock);
    if (mp->nm_context_register_func != nullptr) {
      // 注册插件
      mp->nm_context_register_func(exports, module, context, mp->nm_priv);
    } else if (mp->nm_register_func != nullptr) {
      mp->nm_register_func(exports, module, mp->nm_priv);
    } else {
      dlib->Close();
      THROW_ERR_DLOPEN_FAILED(env, "Module has no declared entry point.");
      return false;
    }

    return true;
  });
}
```

## 环境准备

编译插件我们会用到`node-gyp`，这是一个nodejs用于c++插件跨平台编译的工具。`node-gyp`不是用来构建nodejs的。`node-gyp`支持编译多个node版本的插件，如：0.8, ... , 4, 5, 6, 等版本。

### 安装`node-gyp`

```bash
npm install -g node-gyp
```

如果unix环境，还需要：

- Python (v3.7, v3.8, v3.9, 或v3.10)
- `make`
- c/c++ 编译环境，如`gcc`

如果是mac，则需要：

- Python (v3.7, v3.8, v3.9, 或v3.10)
- `XCode Command Line Tools`（包含了`c/c++`和`make`）

### 设置python依赖

1. 通过命令行调用node-gyp的时候，指定python版本：

```bash
node-gyp <command> --python /path/to/executable/python
```

2. 通过npm调用node-gyp，需要通过npm来配置node-gyp的python版本：

```bash
npm config set python /path/to/executable/python
```

3. 如果在`PATH`变量中有指定python版本的话，这个版本会作为默认python版本
4. 如果设置了`NODE_GYP_FORCE_PYTHON`，那么这个会覆盖以上的设置

## 编译































## 原生写一个c++插件

## nan方式写一个c++插件

## node-api方式写一个c++插件

































