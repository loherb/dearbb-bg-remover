# 批次照片去背 · GPT Image Background Remover

純靜態網頁，使用 OpenAI `gpt-image-1` 模型批次幫照片去背。

## 功能

- 拖曳或選擇多張照片批次上傳
- 自訂去背 Prompt（送給 `gpt-image-1`）
- 可調整輸出尺寸、品質與同時處理數量
- 處理完成後可預覽前後對比（拖曳分隔線）
- 單張下載 PNG，或勾選多張 / 全部打包成 ZIP
- API Key 僅儲存在你自己的瀏覽器 `localStorage`，不會送到任何中介伺服器

## 本機預覽

直接打開 `public/index.html` 即可，或用任何靜態伺服器：

```bash
cd public
python3 -m http.server 5173
# 瀏覽器開啟 http://localhost:5173
```

打開後點右上「設定」，貼上你的 OpenAI API Key。Key 需要有 `gpt-image-1` 的存取權限。

## 部署到 Firebase Hosting

第一次部署：

```bash
# 1. 安裝 Firebase CLI（若尚未安裝）
npm install -g firebase-tools

# 2. 登入
firebase login

# 3. 在 .firebaserc 把 YOUR_FIREBASE_PROJECT_ID 換成你的 Firebase 專案 ID
#    或執行下列指令使用互動式選擇：
firebase use --add

# 4. 部署
firebase deploy --only hosting
```

之後每次更新只要再跑 `firebase deploy --only hosting` 即可。

## 安全提醒

這是純前端版本：API Key 從瀏覽器直接呼叫 OpenAI。**請不要把這個網站公開給不認識的人使用**，否則你的 API 額度會被別人花掉。可以的話請：

- 只給自己或團隊使用，並在 [OpenAI 後台](https://platform.openai.com/api-keys)為這把 key 設定使用上限
- 或改用 Firebase Functions 當代理層，把 API Key 放在 server-side（本專案目前未實作）

## 檔案結構

```
bg-remover/
├── public/
│   ├── index.html      # 主頁
│   ├── style.css       # 樣式
│   └── app.js          # 主要邏輯
├── firebase.json       # Firebase Hosting 設定
├── .firebaserc         # Firebase 專案 ID（部署前要改）
└── README.md
```

## 使用的 API

`POST https://api.openai.com/v1/images/edits`

```
model:          gpt-image-1
image:          <你的圖檔>
prompt:         （可在介面修改）
background:     transparent
output_format:  png
size:           1024x1024 / 1024x1536 / 1536x1024 / auto
quality:        low / medium / high / auto
```
