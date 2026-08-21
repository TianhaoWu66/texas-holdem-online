# 德州风云 · Texas Hold\'em Online

在线**无限注德州扑克**：边池结算、破产补筹、观战、人机对战。仿照「香料商路」站点架构开发。

🌐 在线试玩：https://texaspoker.pythonanywhere.com/

## 🗓️ 更新日志

### 2026-08-21
- 🚀 **独立部署上线**：https://texaspoker.pythonanywhere.com/（PythonAnywhere 账号 `texaspoker`，与香料商路完全独立）
- ✅ 引擎测试：TS 9 组 + Python 30 项全部通过

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
npm run build                              # 构建前端到 pythonanywhere/static
cd pythonanywhere && pip install flask && python app.py          # 启动后端(5001)
```

## ✅ 测试
```bash
npx tsc lib/poker.ts --outDir tests/out --module commonjs --target es2020 --skipLibCheck
Copy-Item tests/out/poker.js tests/out/poker.cjs -Force   # 复制为 .cjs
node --test tests/poker.test.cjs       # TS 引擎（9 组）
python pythonanywhere/test_poker.py    # Python 引擎（30 项）
```


## ☁️ 部署（PythonAnywhere）

当前线上版本部署在 PythonAnywhere 免费账号 **`texaspoker`**，独立站点：

1. 构建前端：`npm run build`（产物在 `pythonanywhere/static/`）
2. 把 `pythonanywhere/` 下的文件上传到服务器 `/home/texaspoker/texas-holdem/`
   （`app.py`、`poker.py`、`accounts.py`、`profile.py`、`requirements.txt`、`static/`）
3. 在 Web 页把 WSGI 配置替换为 `pythonanywhere_wsgi.py` 的内容（路径改成
   `/home/texaspoker/texas-holdem`）
4. Reload，打开 https://texaspoker.pythonanywhere.com/

> PythonAnywhere 系统 Python 已预装 Flask；免费版约 1 个月需登录一次自动续期。

## 🗺️ 路线
- [x] 联机 / 人机 / 边池 / 破产补筹 / 观战 / 账号 / 语音 / PWA / 全屏
- [ ] 离线同屏（传设备轮流）
- [ ] 热点联机（WebRTC 断网多设备）
- [ ] 更多规则（保险、加注上限、锦标赛模式）
