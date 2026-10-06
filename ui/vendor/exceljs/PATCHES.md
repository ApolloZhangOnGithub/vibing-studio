# 对 exceljs.min.js 的改动

- `WorkbookXform.reconcile`：图纸（drawing）解析出来是空的时（WPS、Google 表格等导出的 .xlsx 常见），原来会报
  `Cannot read properties of undefined (reading 'anchors')`，整个文件打不开。改成跳过这张图纸：
  `n&&(o.rels=…` → `n&&r&&(o.rels=…`
