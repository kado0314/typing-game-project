const webcam = document.getElementById('webcam');
const statusElement = document.getElementById('status');
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const canvas = document.getElementById('gameCanvas');

let model;
let targetWord = '';
let score = 0;
let time = 60;
let gameInterval;
let detectionInterval;

// 1. Webカメラの初期化
async function setupCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;
        await new Promise(resolve => webcam.onloadedmetadata = resolve);
        statusElement.textContent = 'カメラ準備完了。モデルをロード中...';
        
        // カメラのサイズを設定（キャンバスにも適用）
        canvas.width = webcam.videoWidth;
        canvas.height = webcam.videoHeight;
        
        await loadModel();
    } catch (error) {
        console.error('カメラの起動に失敗しました:', error);
        statusElement.textContent = 'エラー: カメラを許可してください。';
    }
}

// 2. TensorFlow.jsモデルのロード
async function loadModel() {
    statusElement.textContent = 'モデル (COCO-SSD) をロード中...';
    model = await cocoSsd.load();
    statusElement.textContent = 'モデルロード完了！ゲームスタート！';
    
    startGame();
}

// 3. ゲームの開始
function startGame() {
    typingInput.disabled = false;
    typingInput.focus();
    
    // ゲームタイマーの開始
    gameInterval = setInterval(() => {
        time--;
        timerElement.textContent = time;
        if (time <= 0) {
            endGame();
        }
    }, 1000);
    
    // 物体検出を3秒ごとに行う
    detectionInterval = setInterval(detectObjects, 3000);
    
    // 最初の単語を出題
    detectObjects(true);
}

// 4. 物体検出の実行
async function detectObjects(forceNewWord = false) {
    if (!model) return;

    // カメラ映像から物体検出を実行
    const predictions = await model.detect(webcam);
    
    if (predictions.length === 0) {
        statusElement.textContent = '物体が見当たりません。カメラに何か映してください。';
        targetWordElement.textContent = '---';
        return;
    }
    
    statusElement.textContent = `${predictions.length}個の物体を検出中...`;
    
    // 検出された物体のクラス名（例: 'cup', 'keyboard'）のリスト
    const detectedClasses = predictions.map(p => p.class);

    // 強制出題 (ゲーム開始時) または現在お題がない場合に、新しいお題を設定
    if (forceNewWord || targetWord === '---' || targetWord === '') {
        setNewTargetWord(detectedClasses);
    }
}

// 5. 新しいお題の設定
function setNewTargetWord(classes) {
    if (classes.length > 0) {
        // 検出された中からランダムに一つを選ぶ
        const randomIndex = Math.floor(Math.random() * classes.length);
        targetWord = classes[randomIndex];
        targetWordElement.textContent = targetWord;
        feedbackElement.textContent = '新しいお題です！';
        typingInput.value = '';
    }
}

// 6. タイピング処理
typingInput.addEventListener('input', () => {
    const typedText = typingInput.value;
    
    if (typedText === targetWord) {
        // 正解！
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = '⭕ 正解！';
        
        // 次のお題をすぐに設定するために検出を強制実行
        detectObjects(true); 
    } else if (targetWord.startsWith(typedText)) {
        // 一致している
        feedbackElement.textContent = 'タイピング中...';
    } else {
        // 間違い
        feedbackElement.textContent = '❌ ミス！打ち直してください。';
    }
});

// 7. ゲーム終了
function endGame() {
    clearInterval(gameInterval);
    clearInterval(detectionInterval);
    typingInput.disabled = true;
    targetWordElement.textContent = '---';
    statusElement.textContent = `ゲーム終了！スコア: ${score}点でした。`;
    alert(`ゲーム終了！あなたのスコアは ${score}点です。`);
}

// アプリケーションの開始
setupCamera();
