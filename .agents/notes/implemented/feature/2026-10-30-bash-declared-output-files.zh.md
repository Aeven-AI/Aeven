# Agent Note: 声明的 bash 输出成为经过验证的产物文件

Status: implemented

[English](2026-10-30-bash-declared-output-files.md) | 中文

## 问题

一个会话要求 Aeven 用内置的 LibreOffice 生成一份 PDF 和一份 DOCX。命令执行完成，两份文档也落在工作区里，但收尾的轮次没有显示任何已创建文件块。该块由成功的 `write`、`edit` 和有修改作用的 `str_replace_editor` 调用折叠而成，因此由智能体启动的程序写出的文件没有留下可供 Client 读取的任何条目。轮次自身的结果提到了这些文档，产品却一个也没有显示。

## 决策

`bash` 接受一个可选的 `output_files` 列表，列出命令预期生成的文件。文件系统提供者把每个路径按该调用的 `workdir` 解析，并在命令执行前做一次 stat。命令结束后再次 stat 每个声明路径，新建或版本发生变化的普通文件以 `{ path, created }` 进入持久的结果元数据 `producedFiles`。新建的文件报告 `created: true`，被覆盖的报告 `created: false`。缺失的路径、未变化的文件和目录被排除而不是猜测，因此该元数据只陈述观测确认的内容。

Client 把 `producedFiles` 与修改调用折叠进同一份轮次数据，不按扩展名过滤：PDF、Microsoft Office、OpenDocument、iWork、CSV 与图片都通过同一条路径进入已创建／已编辑文件块。命令文本、stdout 与收尾回复都不参与推断。

声明输出会保持该调用在前台执行：`output_files` 与 `run_in_background: true` 同用会在命令启动前被拒绝，因为后台任务没有可以观测这些路径的完成点。使用该参数的组合必须挂载文件系统提供者；缺少时调用失败，而不是声称自己验证了并不存在的输出。

## 考虑过的替代方案

**在每次 `bash` 调用前后对整个工作区做快照。** 否决：每条命令都要付扫描成本，而声明恰恰是只有调用者才知道的部分。

**从命令中解析路径。** 否决：shell 文本并不是程序写入了什么的可靠陈述，错误的猜测会展示一个并不存在的文件。

**从 stdout 或最终回复推断产物。** 否决：两者都是模型输出，块会列出没有任何观测确认的文件。

## 后果

- 生成文档的命令为每个声明路径在命令前后各付一次 `stat`。
- 未被声明的命令仍与此前一样不出现在块中。
- 面向 Client 的记录是 `tool/result.data.meta.producedFiles`，因此仅凭会话日志即可重建一个轮次的文件。
