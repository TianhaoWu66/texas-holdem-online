# 德州风云 · Texas Hold\'em Online

在线**无限注德州扑克**：边池结算、破产补筹、观战、人机对战。仿照「香料商路」站点架构开发。

## ✨ 功能
- **联机对战**：房间码加入，2–6 人，无限注（NLH）
- **人机对手**：简单 / 普通 / 困难 三档 AI
- **边池结算**：多玩家全下正确分配主池与边池
- **破产补筹**：筹码输光自动补到 1000，并记录破产次数
- **观战**：观众可看公共牌与筹码，但看不到任何人的底牌
- **账号系统**：注册 / 登录 / 游客模式
- **语音快捷聊**、PWA 离线缓存、全屏适配

## 🧱 技术栈
| 部分 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite 静态构建 + Tailwind CSS |
| 引擎 | TypeScript（`lib/poker.ts`）+ Python 移植（`pythonanywhere/poker.py`） |
| 后端 | PythonAnywhere + Flask + SQLite（`pythonanywhere/app.py`） |

## 📁 目录
```
app/poker.tsx          前端（环桌界面/操作/观战）
lib/poker.ts           德州扑克引擎（TS）
pythonanywhere/        Flask 后端 + 引擎 Python 版 + 静态前端
tests/                 引擎测试
```

## 🚀 本地运行
```bash
npm install
npm run build                              # 构建前端（默认根路径 /）
cd pythonanywhere && pip install flask && python app.py          # 启动后端(5001)
```

> 子路径部署（如挂在香料商路站点的 `/poker/` 下）时用：
> `VITE_BASE=/poker/ npm run build`，前端会自动把静态资源与 API 前缀
> 改成 `/poker/...`（API 变 `/poker/api/...`）。

## ✅ 测试
```bash
npx tsc lib/poker.ts --outDir tests/out --module commonjs --target es2020 --skipLibCheck
Copy-Item tests/out/poker.js tests/out/poker.cjs -Force   # 复制为 .cjs（Windows）
node --test tests/poker.test.cjs       # TS 引擎（9 组）
python pythonanywhere/test_poker.py    # Python 引擎（30 项）
```

## ☁️ 部署
- **独立部署**：`pythonanywhere/` 包上传到任意 PythonAnywhere 账号即可（根路径）。
- **与香料商路同站（免费方案）**：把 `pythonanywhere/` 下的后端文件放进
  香料商路部署包的 `poker/` 子目录（含 `__init__.py`），前端用
  `VITE_BASE=/poker/ npm run build` 构建后放进 `poker/static/`；
  香料商路的 `app.py` 会自动挂载 `/poker/` 子应用（见香料商路仓库
  `pythonanywhere/README.md` 的「德州扑克子应用」一节）。

## 🗺️ 路线
- [x] 联机 / 人机 / 边池 / 破产补筹 / 观战 / 账号 / 语音 / PWA / 全屏
- [x] 子路径部署（PythonAnywhere `/poker/`，与香料商路同站共存）
- [ ] 离线同屏（传设备轮流）
- [ ] 热点联机（WebRTC 断网多设备）
- [ ] 更多规则（保险、加注上限、锦标赛模式）
