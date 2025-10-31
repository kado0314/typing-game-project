// --- DOM要素の取得 ---
const webcam = document.getElementById('webcam');
const statusElement = document.getElementById('status');
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const startButton = document.getElementById('startButton');

// --- 定数とゲーム状態 ---
const GAME_DURATION = 60;
let model;
let targetWord = '';
let score = 0;
let time = GAME_DURATION;
let gameInterval;
let detectionInterval;
let stream = null; // カメラストリームを保持
let isGameRunning = false; // ゲーム実行状態

// 許可する物体クラス (COCO-SSDから選択可能な英語お題リスト)
// これ以外のクラスが検出されてもお題にはしません。
const ALLOWED_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep',
    'cup', 'book', 'clock', 'keyboard', 'cell phone', 'mouse', 'bottle', 
    'laptop', 'chair', 'potted plant', 'bed', 'dining table', 'remote', 
    'handbag', 'tie', 'suitcase', 'backpack', 'umbrella'
];

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

    try {
        // カメラの起動
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;
        await new Promise(resolve => webcam.onloadedmetadata = resolve);

        // モデルのロード
        model = await cocoSsd.load();
        
        statusElement.textContent = 'モデルロード完了！「ゲームスタート」を押してください。';
        startButton.disabled = false;
        webcam.style.display = 'block'; // 準備中にカメラ映像を表示
        
    } catch (error) {
        console.error('初期化に失敗しました:', error);
        statusElement.textContent = 'エラー: カメラを許可し、ページをリロードしてください。';
        startButton.disabled = true;
    }
}

// --- 2. ゲームのリセットと開始 ---
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
}

function startGame() {
    if (isGameRunning || !model) return;
    isGameRunning = true;
    
    // UIの更新
    startButton.textContent = 'ゲーム実行中...';
    startButton.disabled = true;
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

    // カメラ映像から物体検出を実行
    const predictions = await model.detect(webcam);
    
    // 許可されたクラスのみを抽出
    const detectedClasses = predictions
        .filter(p => p.score > 0.6 && ALLOWED_CLASSES.includes(p.class))
        .map(p => p.class);

    if (detectedClasses.length > 0) {
        statusElement.textContent = `${detectedClasses.length}種類のお題候補を検出しました。`;
        
        // 強制出題 (ゲーム開始時/正解時) または現在のお題が画面内の物体にない場合に、新しいお題を設定
        if (forceNewWord || targetWord === '---' || !detectedClasses.includes(targetWord)) {
            setNewTargetWord(detectedClasses);
        }
    } else {
        statusElement.textContent = 'お題が見つかりません。カメラに何か映してください。';
        // お題がない場合は一時的に表示をリセット
        if (targetWord !== '---') {
            targetWord = '---';
            targetWordElement.textContent = targetWord;
        }
    }
}

// --- 4. お題の設定 ---
function setNewTargetWord(detectedClasses) {
    if (detectedClasses.length > 0) {
        // 検出された中からランダムに一つを選ぶ
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
    if (targetWord === '---' || !isGameRunning) return;

    const typedText = typingInput.value;
    
    if (typedText === targetWord) {
        // ⭕ 正解
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = `⭕ 正解！「${targetWord}」`;
        
        // 次のお題を設定するために検出を強制実行
        detectObjects(true); 
        
    } else if (targetWord.startsWith(typedText)) {
        // 一致している
        feedbackElement.textContent = 'タイピング中...';
    } else {
        // ❌ ミス
        feedbackElement.textContent = '❌ ミス！打ち直してください。';
    }
});

// コピペ防止 (Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+X, Shift+Insertなど)
typingInput.addEventListener('paste', (e) => e.preventDefault());
typingInput.addEventListener('copy', (e) => e.preventDefault());
typingInput.addEventListener('cut', (e) => e.preventDefault());
typingInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
    }
});


// --- 6. ゲーム終了 ---
function endGame() {
    resetGame();
    stopCamera();
    statusElement.textContent = `ゲーム終了！スコア: ${score}点でした。`;
    alert(`ゲーム終了！あなたのスコアは ${score}点です。`);
}

// --- 7. イベントリスナー ---
startButton.addEventListener('click', startGame);


// アプリケーションの開始
initializeApp();

// ページを離れる際にカメラを停止
window.addEventListener('beforeunload', stopCamera);
