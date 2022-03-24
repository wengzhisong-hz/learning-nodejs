# node初始化过程(js部分)

## 加载 primordials.js

为什么要有primordials这个全局变量？在`lib/internal/per_context/primordials.js`中的注释上写道：

```JavaScript
// This file subclasses and stores the JS builtins that come from the VM
// so that Node.js's builtin modules do not need to later look these up from
// the global proxy, which can be mutated by users.
```


也就是创建一个全局的代理，nodejs可以通过这个代理来访问js内建的方法，而不用担心这个方法被用户修改过。

让我们来看一些简单的例子，这里将处理URI的方法直接拷贝到了primordials对象下：

```JavaScript
[
  decodeURI,
  decodeURIComponent,
  encodeURI,
  encodeURIComponent,
].forEach((fn) => {
  primordials[fn.name] = fn;
});
```


这里将`JSON` 、`Math`等类做了一次代理，并且拷贝了这些类的描述属性:

```JavaScript
[
  'JSON',
  'Math',
  'Proxy',
  'Reflect',
].forEach((name) => {
  copyPropsRenamed(global[name], primordials, name);
});

function copyPropsRenamed(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const name = `${prefix}${newKey}`;
      ReflectDefineProperty(dest, name, desc);
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, `${name}Apply`, {
          value: applyBind(desc.value, src),
        });
      }
    }
  }
}
```


经过不同的代理方式，最终会将primordials的属性进行冻结，防止primordials被修改：

```JavaScript
ObjectFreeze(primordials);
```


## 加载loaders.js

`loaders.js`又做了什么？我们在`lib/internal/bootstrap/loaders.js`中可以看到如下注释：

```JavaScript
// This file creates the internal module & binding loaders used by built-in
// modules. In contrast, user land modules are loaded using
// lib/internal/modules/cjs/loader.js (CommonJS Modules) or
// lib/internal/modules/esm/* (ES Modules).
```


`loaders.js`主要是创建node的内建c++模块，并且提供加载内建c++模块的方法。用户则主要是使用cjs或者esm的方式来加载js模块。

让我们看看详细的过程。

### 初始化process.binding() 、process._linkedBinding()

```JavaScript
{
  const bindingObj = ObjectCreate(null);

  process.binding = function binding(module) {
    module = String(module);
    
    // 这里会根据推荐的程度来选择返回的模块
    // 假如在 internalBindingAllowlist 中存在的模块，
    // 而 runtimeDeprecatedList 也有
    // 那么会返回 internalBindingAllowlist 中的模块并且给出警告
    
    if (internalBindingAllowlist.has(module)) {
      if (runtimeDeprecatedList.has(module)) {
        // 删除不推荐的模块
        runtimeDeprecatedList.delete(module);
        process.emitWarning(
          `Access to process.binding('${module}') is deprecated.`,
          'DeprecationWarning',
          'DEP0111');
      }
      // 如果遗留的模块中有这个的话就返回
      if (legacyWrapperList.has(module)) {
        return nativeModuleRequire('internal/legacy/processbinding')[module]();
      }
      return internalBinding(module);
    }
    throw new Error(`No such module: ${module}`);
  };
  
  process._linkedBinding = function _linkedBinding(module) {
    module = String(module);
    let mod = bindingObj[module];
    if (typeof mod !== 'object')
      mod = bindingObj[module] = getLinkedBinding(module);
    return mod;
  };
}
```


这里出现了三个list，我们以`internalBindingAllowlist`为例，这里列举的方法可以在`src/`文件夹下找到：

```JavaScript
const internalBindingAllowlist = new SafeSet([
  'async_wrap',
  'buffer',
  'cares_wrap',
  'config',
  'constants',
  'contextify',
  'crypto',
  'fs',
  'fs_event_wrap',
  'http_parser',
  'icu',
  'inspector',
  'js_stream',
  'natives',
  'os',
  'pipe_wrap',
  'process_wrap',
  'signal_wrap',
  'spawn_sync',
  'stream_wrap',
  'tcp_wrap',
  'tls_wrap',
  'tty_wrap',
  'udp_wrap',
  'url',
  'util',
  'uv',
  'v8',
  'zlib',
]);

```


例如，`async_wrap`对应着 `src/async_wrap.cc` 中的`async_wrap`模块：

```C++
NODE_MODULE_CONTEXT_AWARE_INTERNAL(async_wrap, node::AsyncWrap::Initialize)
NODE_MODULE_EXTERNAL_REFERENCE(async_wrap,
                               node::AsyncWrap::RegisterExternalReferences)
```


### 初始化internalBinding

```JavaScript
let internalBinding;
{
  const bindingObj = ObjectCreate(null);
  // 获取内建的c++模块的方法：const module = internalBinding('moduleName')
  internalBinding = function internalBinding(module) {
    let mod = bindingObj[module];
    if (typeof mod !== 'object') {
      mod = bindingObj[module] = getInternalBinding(module);
      // moduleLoadList 是一个process的属性，记录了加载的模块和模块加载的顺序
      ArrayPrototypePush(moduleLoadList, `Internal Binding ${module}`);
    }
    return mod;
  };
}
```


### 初始化require

最终`loaders.js`会导出`loaderExports`对象到c++环境中：

```JavaScript
const loaderExports = {
  internalBinding,
  NativeModule,
  require: nativeModuleRequire
};

return loaderExports;

```


这个对象包含：

- 用于获取内建c++模块的`internalBinding`方法
- 用于描述内建js模块的类`NativeModule`
- 用于加载内建js模块的`require` 方法

让我们看看`require` 方法：

```JavaScript
function nativeModuleRequire(id) {
  if (id === loaderId) {
    return loaderExports;
  }
  const mod = NativeModule.map.get(id);
  if (!mod) throw new TypeError(`Missing internal module '${id}'`);
  return mod.compileForInternalLoader();
}
```


## 加载 node.js

在js内建方法、node内建c++模块都加载完毕之后，node会开始加载js模块了。这些js模块的实现依赖于js内建方法、c++内建模块。

主要流程如下：

```JavaScript
// 初始化process对象
setupProcessObject();
// 初始化buffer
setupBuffer();

// 初始化main线程和worker线程
const perThreadSetup = require('internal/process/per_thread');
// 初始化js的事件队列
const {
  setupTaskQueue,
  queueMicrotask,
} = require('internal/process/task_queues');
// 初始化nextTick
const { nextTick, runNextTicks } = setupTaskQueue();

// 预加载一系列的内建c++模块
require('fs');
require('v8');
require('vm');
require('url');

```


## 总结

整个js部分的初始化流程如下：

1. 将`primordials`代理到js原生方法上
2. 加载c++的内建模块，并提供js方法`internalBinding()`方法来访问这些模块
3. 初始化`require()` 方法，用于加载内建的js模块
4. 初始化进程和线程
5. 预加载一些模块
