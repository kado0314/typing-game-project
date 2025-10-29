const webcam = document.getElementById('webcam');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const statusElement = document.getElementById('status');
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const cameraModeBtn = document.getElementById('cameraModeBtn');
const normalModeBtn = document.getElementById('normalModeBtn');

// --- 定数とゲーム状態 ---
const GAME_DURATION = 60;
let model;
let targetWord = '';
let score = 0;
let time = GAME_DURATION;
let gameMode = 'camera'; // 'camera' or 'normal'
let usedWords = new Set(); // 一度出題したお題を記憶
let gameInterval;
let detectionInterval;
let stream = null; // カメラストリームを保持

// 英語クラス名 -> 日本語名のマッピング
const JAPANESE_MAPPING = {
    'person': '人', 'bicycle': '自転車', 'car': '車', 'motorcycle': 'バイク', 'airplane': '飛行機', 'bus': 'バス', 'train': '電車', 'truck': 'トラック', 'boat': '船',
    'traffic light': '信号', 'fire hydrant': '消火栓', 'stop sign': '一時停止', 'bench': 'ベンチ', 'bird': '鳥', 'cat': '猫', 'dog': '犬', 'horse': '馬', 'sheep': '羊',
    'cow': '牛', 'elephant': '象', 'bear': '熊', 'giraffe': 'キリン', 'backpack': 'リュック', 'umbrella': '傘', 'handbag': 'カバン', 'tie': 'ネクタイ', 'suitcase': 'スーツケース',
    'sports ball': 'ボール', 'kite': '凧', 'baseball bat': 'バット', 'baseball glove': 'グローブ', 'skateboard': 'スケートボード', 'surfboard': 'サーフボード', 'tennis racket': 'テニスラケット',
    'bottle': 'ボトル', 'wine glass': 'ワイングラス', 'cup': 'コップ', 'fork': 'フォーク', 'knife': 'ナイフ', 'spoon': 'スプーン', 'bowl': 'ボウル', 'banana': 'バナナ',
    'apple': 'リンゴ', 'sandwich': 'サンドイッチ', 'orange': 'オレンジ', 'broccoli': 'ブロッコリー', 'carrot': 'ニンジン', 'hot dog': 'ホットドッグ', 'pizza': 'ピザ', 'donut': 'ドーナツ',
    'cake': 'ケーキ', 'chair': '椅子', 'couch': 'ソファ', 'potted plant': '植木鉢', 'bed': 'ベッド', 'dining table': 'テーブル', 'toilet': 'トイレ', 'tv': 'テレビ',
    'laptop': 'ノートパソコン', 'mouse': 'マウス', 'remote': 'リモコン', 'keyboard': 'キーボード', 'cell phone': '携帯電話', 'microwave': '電子レンジ', 'oven': 'オーブン',
    'sink': 'シンク', 'refrigerator': '冷蔵庫', 'book': '本', 'clock': '時計', 'vase': '花瓶', 'scissors': 'ハサミ', 'teddy bear': 'テディベア', 'hair drier': 'ドライヤー', 'toothbrush': '歯ブラシ'
};

// ノーマルモード用の日本語単語リスト
const JAPANESE_NORMAL_WORDS = [
    'さくら', 'たいよう', 'でんしゃ', 'きつね', 'たいふう',
    'りんご', 'みかん', 'がっこう', 'そら', 'うみ', 
    'かわ', 'ゆき', 'かぜ', 'ねこ', 'いぬ', 
    'さかな', 'とり', 'けいと', 'たいぴんぐ', 'ぷろぐらむ'
];


// --- 1. カメラとモデルの初期化 ---
async function setupCamera() {
    if (stream) return; // 既に起動済みの場合はスキップ
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;
        await new Promise(resolve => webcam.onloadedmetadata = resolve);

        // カメラの解像度に合わせてキャンバスサイズを設定
        canvas.width = webcam.videoWidth;
        canvas.height = webcam.videoHeight;
        
        // モデルは一度だけロード
        if (!model) {
            statusElement.textContent = 'カメラ準備完了。モデルをロード中...';
            model = await cocoSsd.load();
        }
        
        statusElement.textContent = 'モデルロード完了！';
        
    } catch (error) {
        console.error('カメラの起動に失敗しました:', error);
        statusElement.textContent = 'エラー: カメラの使用を許可してください。';
    }
}

// カメラを停止する
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        webcam.srcObject = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height); // キャンバスをクリア
        statusElement.textContent = 'カメラは停止中です。';
    }
}

// --- 2. ゲームのリセットと開始 ---
function resetGame() {
    clearInterval(gameInterval);
    clearInterval(detectionInterval);
    usedWords.clear();
    score = 0;
    time = GAME_DURATION;
    targetWord = '---';
    
    // UIの初期化
    scoreElement.textContent = score;
    timerElement.textContent = time;
    targetWordElement.textContent = targetWord;
    typingInput.value = '';
    typingInput.disabled = true;
    feedbackElement.textContent = '';
}

function startGame() {
    resetGame();
    
    typingInput.disabled = false;
    typingInput.focus();

    // タイマー開始
    gameInterval = setInterval(() => {
        time--;
        timerElement.textContent = time;
        if (time <= 0) {
            endGame();
        }
    }, 1000);
    
    if (gameMode === 'camera') {
        setupCamera().then(() => {
            if (model) {
                // カメラモード: 300msごとに描画、3秒ごとに検出
                detectionInterval = setInterval(detectAndDraw, 300);
                detectAndDraw(true); // 即座に最初の検出とお題を設定
            }
        });
    } else { // normal
        stopCamera();
        canvas.style.display = 'none';
        setNewTargetWord(); // ノーマルモードのお題を設定
        statusElement.textContent = 'ノーマルモードでプレイ中。';
    }
}

// --- 3. 物体検出と描画 (カメラモード専用) ---
let lastDetectionTime = 0;
const DETECTION_INTERVAL_MS = 3000; // 3秒に一度の検出

async function detectAndDraw(forceNewWord = false) {
    // 描画
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 鏡のように反転描画
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(webcam, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    const currentTime = Date.now();
    let predictions = [];

    // 3秒に一度だけ物体検出を実行
    if (currentTime - lastDetectionTime >= DETECTION_INTERVAL_MS) {
        if (model) {
            predictions = await model.detect(webcam);
            lastDetectionTime = currentTime;
        }

        // 検出結果から日本語のお題候補を作成
        const detectedJapaneseWords = predictions
            .filter(p => p.score > 0.6 && JAPANESE_MAPPING[p.class]) // 信頼度フィルタと日本語変換可能チェック
            .map(p => JAPANESE_MAPPING[p.class]);

        if (detectedJapaneseWords.length > 0) {
            statusElement.textContent = `${detectedJapaneseWords.length}種類のお題候補を検出しました。`;
            // 新しいお題のチェックと設定
            if (forceNewWord || targetWord === '---' || !detectedJapaneseWords.includes(targetWord)) {
                setNewTargetWord(detectedJapaneseWords);
            }
        } else {
            statusElement.textContent = '物体が見当たりません。またはお題が見つかりません。';
            // targetWordが既に'---'でない場合はそのまま維持
        }
    }
    
    // 常に最新の検出結果を描画 (predictionsが空の場合は、前回検出時の枠を維持せずクリア)
    if (predictions.length > 0) {
        predictions.forEach(p => drawBoundingBox(p));
    }
}

// バウンディングボックスの描画
function drawBoundingBox(prediction) {
    const [x, y, width, height] = prediction.bbox;
    const label = JAPANESE_MAPPING[prediction.class] || prediction.class;

    // キャンバスは反転表示されているため、座標を調整
    const mirroredX = canvas.width - x - width;

    ctx.beginPath();
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 4;
    ctx.rect(mirroredX, y, width, height);
    ctx.stroke();

    ctx.fillStyle = '#4CAF50';
    ctx.font = '24px Arial';
    ctx.fillText(label, mirroredX + 5, y > 10 ? y - 5 : y + 20);
}


// --- 4. お題の設定 ---
function setNewTargetWord(detectedWords = []) {
    let newWord = '';
    let wordList = [];

    if (gameMode === 'camera') {
        wordList = detectedWords;
    } else { // normal
        wordList = JAPANESE_NORMAL_WORDS;
    }
    
    // 既出でない単語を選出
    const availableWords = wordList.filter(word => !usedWords.has(word));

    if (availableWords.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableWords.length);
        newWord = availableWords[randomIndex];
        usedWords.add(newWord); // 既出リストに追加
    } else {
        // 出題可能な単語がない場合 (全単語出題済み)
        if (gameMode === 'camera') {
             feedbackElement.textContent = '検出された全ての物体を出題しました！';
        } else {
             feedbackElement.textContent = '全てのノーマル単語を出題しました！';
             usedWords.clear(); // ノーマルモードの場合はリセットして再利用
             return setNewTargetWord();
        }
    }
    
    if (newWord) {
        targetWord = newWord;
        targetWordElement.textContent = targetWord;
        feedbackElement.textContent = '新しいお題です！';
        typingInput.value = '';
    }
}

// --- 5. タイピング処理 ---
typingInput.addEventListener('input', () => {
    if (targetWord === '---') return;

    const typedText = typingInput.value;
    
    if (typedText === targetWord) {
        // 正解
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = `⭕ 正解！「${targetWord}」`;
        
        if (gameMode === 'camera') {
             // カメラモードでは検出に任せる (次の描画ループで新しいお題がセットされる)
        } else {
             // ノーマルモードでは即座に次のお題を設定
             setNewTargetWord();
        }
        typingInput.value = '';
        
    } else if (targetWord.startsWith(typedText)) {
        // 一致している
        feedbackElement.textContent = 'タイピング中...';
    } else {
        // ミス
        feedbackElement.textContent = '❌ ミス！打ち直してください。';
    }
});

// --- 6. ゲーム終了 ---
function endGame() {
    clearInterval(gameInterval);
    clearInterval(detectionInterval);
    typingInput.disabled = true;
    targetWordElement.textContent = '---';
    statusElement.textContent = `ゲーム終了！スコア: ${score}点でした。`;
    alert(`ゲーム終了！あなたのスコアは ${score}点です。`);
    
    if (gameMode === 'camera') {
        // ゲーム終了後も描画ループは停止
        stopCamera();
    }
}

// --- 7. モード切り替えイベント ---
cameraModeBtn.addEventListener('click', () => {
    if (gameMode !== 'camera') {
        gameMode = 'camera';
        cameraModeBtn.classList.add('active-mode');
        normalModeBtn.classList.remove('active-mode');
        canvas.style.display = 'block';
        startGame();
    }
});

normalModeBtn.addEventListener('click', () => {
    if (gameMode !== 'normal') {
        gameMode = 'normal';
        normalModeBtn.classList.add('active-mode');
        cameraModeBtn.classList.remove('active-mode');
        stopCamera();
        canvas.style.display = 'none'; // キャンバスを非表示
        startGame();
    }
});


// 初期起動
startGame();
