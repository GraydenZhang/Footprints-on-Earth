# Footprints on Earth

一个本地运行的足迹 CSV 可视化网页，灵感来源于解决 一生足迹app http://steplife.cn/ 没有 web界面 或 Windows App ，在 Windows 平台使用不便的问题。（本项目为非官方开源工具，与“一生足迹”官方及其开发者无关联。）

默认加载 `data/footprint_test_file.csv` 作为演示数据(该数据不代表任何真实足迹），在页面里选择或拖入自己的 CSV 文件即可在本地查看。当前版本主要适配 “一生足迹”App 导出的 CSV 数据格式。项目不包含“一生足迹”的源码、图标、Logo、素材或官方数据。

项目使用 MapLibre GL JS 和 OpenStreetMap 瓦片渲染 3D 地球/平面地图，支持足迹点、轨迹线、日期筛选、数据点列表，以及可选的高德地图图源。

## 运行

需要先安装 Node.js。

```bash
./serve.sh
```

Windows PowerShell 也可以运行：

```powershell
.\serve.ps1
```

然后在浏览器打开：

```text
http://127.0.0.1:5173/
```

## CSV 数据

默认演示文件位于：

```text
data/footprint_test_file.csv
```

CSV 至少需要包含 `dataTime`、`longitude`、`latitude` 三列。如果有 `speed`、`distance`、`altitude`、`heading` 等字段，页面也会一起读取并显示。

为了避免误传私人足迹数据，`.gitignore` 会忽略 `data/` 下的其他 CSV，只保留 `data/footprint_test_file.csv` 作为公开演示文件。使用自己的真实数据时，推荐直接在页面点击“选择 CSV”，或把 CSV 文件拖入窗口。

## 功能

- OpenStreetMap 实时地图瓦片
- MapLibre GL JS 3D 地球和平面地图
- 足迹点、轨迹线和地图视野自适应
- 年、月、日筛选与时间范围筛选
- 数据点列表和地图点联动高亮
- 可选高德地图图源，Key 和安全密钥只保存在浏览器本地

## 发布版

`v0.1` 发布版提供两个演示包：

- `FootprintsOnEarth-portable.exe`：单文件便携版，内置网页和演示 CSV。
- `FootprintsOnEarth-portable.zip`：文件夹版，解压后双击 `FootprintsOnEarth.exe` 运行。

发布版里的默认演示 CSV 名称同样是 `footprint_test_file.csv`。
