// --- DOM要素の取得 ---
const webcam = document.getElementById('webcam');
const statusElement = document.getElementById('status');
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const startButton = document.getElementById('startButton');

// ▼▼▼ モーダル用DOM要素を追加 ▼▼▼
const detailsButton = document.getElementById('detailsButton');
const detailsModal = document.getElementById('detailsModal');
const closeButton = document.getElementsByClassName('closeButton')[0];
const classListContainer = document.getElementById('classListContainer');

// --- 定数とゲーム状態 ---
const GAME_DURATION = 60;
let model;
let targetWord = '';
let score = 0;
let time = GAME_DURATION;
let gameInterval;
let detectionInterval;
let stream = null; 
let isGameRunning = false;

// ▼▼▼ COCO-SSD 90クラスの英語・日本語対応表 ▼▼▼
const COCO_CLASSES = {
    'person': '人', 'bicycle': '自転車', 'car': '車', 'motorcycle': 'バイク', 'airplane': '飛行機',
    'bus': 'バス', 'train': '電車', 'truck': 'トラック', 'boat': '船', 'traffic light': '信号',
    'fire hydrant': '消火栓', 'stop sign': '一時停止標識', 'parking meter': 'パーキングメーター', 'bench': 'ベンチ',
    'bird': '鳥', 'cat': '猫', 'dog': '犬', 'horse': '馬', 'sheep': '羊',
    'cow': '牛', 'elephant': '象', 'bear': '熊', 'zebra': 'シマウマ', 'giraffe': 'キリン',
    'backpack': 'リュック', 'umbrella': '傘', 'handbag': 'ハンドバッグ', 'tie': 'ネクタイ', 'suitcase': 'スーツケース',
    'frisbee': 'フリスビー', 'skis': 'スキー板', 'snowboard': 'スノーボード', 'sports ball': 'ボール', 'kite': '凧',
    'baseball bat': 'バット', 'baseball glove': 'グローブ', 'skateboard': 'スケートボード', 'surfboard': 'サーフボード',
    'tennis racket': 'テニスラケット', 'bottle': 'ボトル', 'wine glass': 'ワイングラス', 'cup': 'コップ', 'fork': 'フォーク',
    'knife': 'ナイフ', 'spoon': 'スプーン', 'bowl': 'ボウル', 'banana': 'バナナ', 'apple': 'リンゴ',
    'sandwich': 'サンドイッチ', 'orange': 'オレンジ', 'broccoli': 'ブロッコリー', 'carrot': 'ニンジン', 'hot dog': 'ホットドッグ',
    'pizza': 'ピザ', 'donut': 'ドーナツ', 'cake': 'ケーキ', 'chair': '椅子', 'couch': 'ソファ',
    'potted plant': '植木鉢', 'bed': 'ベッド', 'dining table': 'テーブル', 'toilet': 'トイレ', 'tv': 'テレビ',
    'laptop': 'ノートパソコン', 'mouse': 'マウス', 'remote': 'リモコン', 'keyboard': 'キーボード', 'cell phone': '携帯電話',
    'microwave': '電子レンジ', 'oven': 'オーブン', 'toaster': 'トースター', 'sink': '流し台', 'refrigerator': '冷蔵庫',
    'book': '本', 'clock': '時計', 'vase': '花瓶', 'scissors': 'はさみ', 'teddy bear': 'テディベア',
    'hair drier': 'ドライヤー', 'toothbrush': '歯ブラシ'
};

// 許可リストを対応表の全キー（英語名）から自動生成
const ALLOWED_CLASSES = Object.keys(COCO_CLASSES);

// --- 1. 初期化とモデルロード ---

// カメラを停止する
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        webcam.srcObject = null;
    }
    webcam.style.display = 'none';
}

// カメラとモデルを初期化（非同期）
async function initializeApp() {
    statusElement.textContent = 'カメラを起動し、モデルをロード中です...';
    startButton.disabled = true;
    detailsButton.disabled = true;

    try {
        // カメラの起動
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;
        await new Promise(resolve => webcam.onloadedmetadata = resolve);

        // モデルのロード
        model = await cocoSsd.load();
        
        statusElement.textContent = '準備完了！「ゲームスタート」を押してください。';
        startButton.disabled = false;
        detailsButton.disabled = false; // 詳細ボタンを有効化
        webcam.style.display = 'block'; 
        
        // モーダルのリストを作成
        populateClassList();
        
    } catch (error) {
        console.error('初期化に失敗しました:', error);
        statusElement.textContent = 'エラー: カメラを許可し、ページをリロードしてください。';
    }
}

// --- 2. ゲームのリセットと開始 ---

// resetGame() をリプレイ可能なように修正
function resetGame() {
    clearInterval(gameInterval);
    clearInterval(detectionInterval);
    
    score = 0;
    time = GAME_DURATION;
    targetWord = '---';
    isGameRunning = false;

    scoreElement.textContent = score;
    timerElement.textContent = time;
    targetWordElement.textContent = targetWord;
    
    typingInput.value = '';
    typingInput.disabled = true;
    feedbackElement.textContent = '';
    
    startButton.textContent = 'ゲームスタート';
    startButton.disabled = false;
    detailsButton.disabled = false; // 詳細ボタンを再有効化
}

function startGame() {
    if (isGameRunning || !model) return;
    isGameRunning = true;
    
    // UIの更新
    startButton.textContent = 'ゲーム実行中...';
    startButton.disabled = true;
    detailsButton.disabled = true; // ゲーム中は詳細を見れないように
    typingInput.disabled = false;
    typingInput.focus();
    webcam.style.display = 'block';

    // ゲームタイマー開始
    gameInterval = setInterval(() => {
        time--;
        timerElement.textContent = time;
        if (time <= 0) {
            endGame();
        }
    }, 1000);
    
    // 物体検出を3秒ごとに行う
    detectionInterval = setInterval(detectObjects, 3000);
    detectObjects(true); // 即座に最初の検出とお題を設定
    statusElement.textContent = 'ゲーム開始！カメラに映るものを入力してください。';
}

// --- 3. 物体検出 ---
async function detectObjects(forceNewWord = false) {
    if (!model || !stream) return;

    const predictions = await model.detect(webcam);
    
    // 許可されたクラスのみを抽出 (ALLOWED_CLASSES は全リストになった)
    const detectedClasses = predictions
        .filter(p => p.score > 0.6 && ALLOWED_CLASSES.includes(p.class))
        .map(p => p.class);

    if (detectedClasses.length > 0) {
        statusElement.textContent = `${detectedClasses.length}種類のお題候補を検出しました。`;
        
        if (forceNewWord || targetWord === '---' || !detectedClasses.includes(targetWord)) {
            setNewTargetWord(detectedClasses);
        }
    } else {
        statusElement.textContent = 'お題が見つかりません。カメラに何か映してください。';
        if (targetWord !== '---') {
            targetWord = '---';
            targetWordElement.textContent = targetWord;
        }
    }
}

// --- 4. お題の設定 ---
function setNewTargetWord(detectedClasses) {
    if (detectedClasses.length > 0) {
        const randomIndex = Math.floor(Math.random() * detectedClasses.length);
        const newWord = detectedClasses[randomIndex];
        
        targetWord = newWord;
        targetWordElement.textContent = targetWord;
        feedbackElement.textContent = '新しいお題です！「' + targetWord + '」';
        typingInput.value = '';
        typingInput.focus();
    }
}

// --- 5. タイピング処理とコピペ禁止 ---
typingInput.addEventListener('input', () => {
    // (省略: このセクションは変更ありません)
    if (targetWord === '---' || !isGameRunning) return;
    const typedText = typingInput.value;
    if (typedText === targetWord) {
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = `⭕ 正解！「${targetWord}」`;
        detectObjects(true); 
    } else if (targetWord.startsWith(typedText)) {
        feedbackElement.textContent = 'タイピング中...';
    } else {
        feedbackElement.textContent = '❌ ミス！打ち直してください。';
    }
});

// (省略: コピペ防止リスナーも変更ありません)
typingInput.addEventListener('paste', (e) => e.preventDefault());
typingInput.addEventListener('copy', (e) => e.preventDefault());
typingInput.addEventListener('cut', (e) => e.preventDefault());
typingInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
    }
});


// --- 6. ゲーム終了 ---

// endGame() をリプレイ可能なように修正
function endGame() {
    // stopCamera() を削除！カメラは起動したままにする
    statusElement.textContent = `ゲーム終了！スコア: ${score}点でした。「スタート」で再挑戦できます。`;
    alert(`ゲーム終了！あなたのスコアは ${score}点です。`);
    
    // resetGame() を呼び出してUIを初期状態に戻す
    resetGame();
}

// --- 7. イベントリスナー ---
startButton.addEventListener('click', startGame);

// ページを離れる際にカメラを停止
window.addEventListener('beforeunload', stopCamera);


// --- 8. ▼▼▼ モーダル処理 ▼▼▼ ---

// リストを生成してコンテナに挿入
function populateClassList() {
    let htmlContent = '';
    // COCO_CLASSESオブジェクトをループ処理
    for (const [english, japanese] of Object.entries(COCO_CLASSES)) {
        htmlContent += `<p><strong>${english}</strong>: ${japanese}</p>`;
    }
    classListContainer.innerHTML = htmlContent;
}

// 「詳細」ボタンがクリックされたらモーダルを表示
detailsButton.addEventListener('click', () => {
    detailsModal.style.display = 'block';
});

// 「×」ボタンがクリックされたらモーダルを非表示
closeButton.addEventListener('click', () => {
    detailsModal.style.display = 'none';
});

// モーダルの外側（背景）がクリックされたらモーダルを非表示
window.addEventListener('click', (event) => {
    if (event.target == detailsModal) {
        detailsModal.style.display = 'none';
    }
});

// アプリケーションの開始
initializeApp();
