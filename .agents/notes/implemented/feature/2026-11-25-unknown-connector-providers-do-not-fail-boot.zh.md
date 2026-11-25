# Agent Note：未知的连接器提供方不再导致启动失败

Status: implemented

[English](2026-11-25-unknown-connector-providers-do-not-fail-boot.md) | 中文

## 问题

桌面端各版本共用 `~/.aeven/storages/account_integrations.json`。某个版本以另一个版本不认识的提供方保存的连接器（例如 0.3.66 读取的 `notion`，或之后版本读取的已移除的 `compute-engine`）会使 `account_integrations` 域以 `invalid-record` 打开失败，整个插件树随之失败，应用无法启动。

## 决定

`storage-domain` 新增 `invalidRecords: 'skip'` 策略：不符合表结构的记录原样留在存储介质中，失败以警告记录，打开继续进行且不含该记录，因此写入它的版本仍能读取它。`account_integrations` 声明了该策略。已有的 `'backup-and-skip'` 会把记录移到一旁，会丢失较新版本的连接器，因此不适用。

## 影响

不认识某提供方的版本不会显示也无法使用该连接器；当认识该提供方的版本打开存储时，记录重新出现。此修改之前发布的版本遇到这类记录仍会失败，需要更新。
