// --- 定数 ---
const GAME_DURATION = 60;
const DETECTION_INTERVAL_MS = 2000; // 検出間隔 (ミリ秒)
const DETECTION_THRESHOLD = 0.6;   // 検出の信頼度閾値

// --- DOM要素の取得 ---
// モード選択
const modeSelection = document.getElementById('modeSelection');
const startCameraButton = document.getElementById('startCameraButton');
const startNormalButton = document.getElementById('startNormalButton');
const detailsButton = document.getElementById('detailsButton');

// ゲームエリア
const gameArea = document.getElementById('gameArea');
const webcam = document.getElementById('webcam');
const gameCanvas = document.getElementById('gameCanvas');
const statusElement = document.getElementById('status');
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const stopButton = document.getElementById('stopButton');

// モーダル
const detailsModal = document.getElementById('detailsModal');
const closeButton = document.getElementsByClassName('closeButton')[0];
const classListContainer = document.getElementById('classListContainer');

// --- ゲーム状態管理 (カプセル化) ---
const gameState = {
    model: null,
    stream: null,
    ctx: gameCanvas.getContext('2d'),
    mode: 'camera', // 'camera' or 'normal'
    targetWord: '',
    score: 0,
    time: GAME_DURATION,
    gameInterval: null,
    lastDetectionTime: 0,
    isGameRunning: false,
    modelLoaded: false,
    cameraInitialized: false,
    predictions: [], // 検出結果 (Canvas描画用)
    answeredWords: new Set() // (新機能) 正解済み単語リスト
};


// --- 1. 初期化処理 ---

// アプリ全体の初期化
function initializeApp() {
    statusElement.textContent = 'モードを選択してください。';
    startCameraButton.disabled = false;
    startNormalButton.disabled = false;
    detailsButton.disabled = false;
    
    // モーダルのリストを作成
    populateClassList();

    // イベントリスナーの設定
    startCameraButton.addEventListener('click', initCameraAndModel);
    startNormalButton.addEventListener('click', () => startGame('normal'));
    stopButton.addEventListener('click', returnToModeSelection);

    // (改善) コピペ禁止 (JSで設定)
    setupInputListeners();

    // モーダル用リスナー
    setupModalListeners();

    // ページを離れる際にカメラを停止
    window.addEventListener('beforeunload', stopCamera);
}

// (新機能) ノーマルモードからカメラモードに切り替える際に実行
async function initCameraAndModel() {
    if (gameState.modelLoaded && gameState.cameraInitialized) {
        startGame('camera');
        return;
    }

    statusElement.textContent = 'カメラとAIモデルを準備中です...';
    startCameraButton.disabled = true;
    startNormalButton.disabled = true;

    try {
        // カメラの起動 (まだなら)
        if (!gameState.cameraInitialized) {
            gameState.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } // (改善) 外カメラを優先
            });
            webcam.srcObject = gameState.stream;
            await new Promise(resolve => webcam.onloadedmetadata = resolve);
            
            // Canvasのサイズをビデオに合わせる
            gameCanvas.width = webcam.videoWidth;
            gameCanvas.height = webcam.videoHeight;
            gameState.cameraInitialized = true;
        }
        
        // モデルのロード (まだなら)
        if (!gameState.modelLoaded) {
            gameState.model = await cocoSsd.load();
            gameState.modelLoaded = true;
        }

        startGame('camera');

    } catch (error) {
        console.error('カメラまたはモデルの初期化に失敗:', error);
        statusElement.textContent = 'エラー: カメラを許可し、ページをリロードしてください。';
        startCameraButton.disabled = false;
        startNormalButton.disabled = false;
    }
}


// --- 2. ゲームの開始 / 終了 / リセット ---

function resetGame() {
    clearInterval(gameState.gameInterval);
    
    gameState.score = 0;
    gameState.time = GAME_DURATION;
    gameState.targetWord = '---';
    gameState.isGameRunning = false;
    gameState.predictions = [];
    gameState.answeredWords.clear(); // (新機能) 正解リストをリセット

    scoreElement.textContent = gameState.score;
    timerElement.textContent = gameState.time;
    targetWordElement.textContent = gameState.targetWord;
    
    typingInput.value = '';
    typingInput.disabled = true;
    feedbackElement.textContent = '';
    
    // Canvasをクリア
    gameState.ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
}

function startGame(mode) {
    resetGame(); // まずリセット
    gameState.isGameRunning = true;
    gameState.mode = mode;

    // UI切り替え
    modeSelection.style.display = 'none';
    gameArea.style.display = 'block';
    typingInput.disabled = false;
    typingInput.focus();

    if (mode === 'camera') {
        statusElement.textContent = 'ゲーム開始！カメラに映るものを入力してください。';
        webcam.style.display = 'block';
        gameCanvas.style.display = 'block';
        detectObjects(true); // 即座に最初の検出とお題を設定
        gameState.lastDetectionTime = performance.now();
        requestAnimationFrame(gameLoop); // (改善) rAFループ開始
    } else {
        statusElement.textContent = 'ゲーム開始！表示されるお題を入力してください。';
        webcam.style.display = 'none'; // ノーマルモードでは非表示
        gameCanvas.style.display = 'none';
        setNewNormalWord(); // (新機能) ノーマルモードのお題設定
    }

    // ゲームタイマー開始
    gameState.gameInterval = setInterval(() => {
        gameState.time--;
        timerElement.textContent = gameState.time;
        if (gameState.time <= 0) {
            endGame();
        }
    }, 1000);
}

function endGame() {
    gameState.isGameRunning = false;
    clearInterval(gameState.gameInterval);
    
    statusElement.textContent = `ゲーム終了！スコア: ${gameState.score}点でした。「終了」ボタンでモード選択に戻れます。`;
    alert(`ゲーム終了！あなたのスコアは ${gameState.score}点です。`);
    
    typingInput.disabled = true;
    // resetGame() は呼ばない (stopButtonでリセット)
}

function returnToModeSelection() {
    endGame(); // 念のためゲームを終了
    resetGame(); // 状態をリセット
    
    // UI切り替え
    gameArea.style.display = 'none';
    modeSelection.style.display = 'block';
    statusElement.textContent = 'モードを選択してください。';
    
    // ボタンを再度有効化
    startCameraButton.disabled = false;
    startNormalButton.disabled = false;
}

function stopCamera() {
    if (gameState.stream) {
        gameState.stream.getTracks().forEach(track => track.stop());
        gameState.stream = null;
        webcam.srcObject = null;
        gameState.cameraInitialized = false;
    }
}


// --- 3. (改善) ゲームループ (rAF) と Canvas描画 ---

function gameLoop(timestamp) {
    if (!gameState.isGameRunning) return;

    // Canvas描画 (毎フレーム)
    drawDetections();

    // 一定間隔で物体検出
    if (timestamp - gameState.lastDetectionTime > DETECTION_INTERVAL_MS) {
        gameState.lastDetectionTime = timestamp;
        detectObjects(false); // 通常の検出 (お題変更は強制しない)
    }

    requestAnimationFrame(gameLoop); // 次のフレームを要求
}

function drawDetections() {
    const ctx = gameState.ctx;
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    
    // カメラ映像をCanvasに転写
    ctx.drawImage(webcam, 0, 0, gameCanvas.width, gameCanvas.height);

    // 検出結果を描画
    ctx.font = '16px Arial';
    ctx.lineWidth = 3;

    gameState.predictions.forEach(p => {
        // (新機能) 現在のお題は色を変える
        if (p.class === gameState.targetWord) {
            ctx.strokeStyle = '#E91E63'; // ピンク
            ctx.fillStyle = '#E91E63';
        } else {
            ctx.strokeStyle = '#00FFFF'; // シアン
            ctx.fillStyle = '#00FFFF';
        }

        // 枠
        ctx.beginPath();
        ctx.rect(p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
        ctx.stroke();
        
        // ラベル
        ctx.fillRect(p.bbox[0], p.bbox[1], p.bbox[2], 20); // ラベル背景
        ctx.fillStyle = '#000000';
        ctx.fillText(`${p.class} (${Math.round(p.score * 100)}%)`, p.bbox[0] + 5, p.bbox[1] + 15);
    });
}


// --- 4. 物体検出とお題設定 (カメラモード) ---

async function detectObjects(forceNewWord = false) {
    if (!gameState.model || !gameState.stream || !gameState.isGameRunning) return;

    const predictions = await gameState.model.detect(webcam);
    
    // 検出結果をCanvas描画用に保存
    gameState.predictions = predictions.filter(p => p.score > DETECTION_THRESHOLD);

    // (改善) 検出されたクラス (ユニーク)
    const detectedClasses = new Set(
        gameState.predictions.map(p => p.class)
    );
    
    // (新機能) 検出リストから、既に正解したものを除外
    const availableTargets = [...detectedClasses].filter(
        word => !gameState.answeredWords.has(word)
    );

    if (availableTargets.length > 0) {
        statusElement.textContent = `${availableTargets.length}種類のお題候補を検出中。`;
        
        // (新機能: お題持続) 
        // お題が '---' か、正解直後(forceNewWord) で、
        // (新機能: お題持続) 現在のお題がカメラから見えなくなった場合のみ、新しいお題を設定
        if (forceNewWord || gameState.targetWord === '---' || !detectedClasses.has(gameState.targetWord)) {
            setNewTargetWord(availableTargets);
        }
    } else if (gameState.targetWord === '---') { // (お題持続) お題が既にある場合は、見失っても '---' に戻さない
        statusElement.textContent = 'お題が見つかりません。カメラに何か映してください。';
        gameState.targetWord = '---';
        targetWordElement.textContent = '---';
    }
}

// お題を設定 (カメラ / ノーマル共通ロジック)
function setTargetWord(newWord) {
    gameState.targetWord = newWord;
    targetWordElement.textContent = newWord;
    feedbackElement.textContent = `新しいお題: 「${newWord}」`;
    typingInput.value = '';
    typingInput.focus();
}

// カメラモード用のお題設定
function setNewTargetWord(availableTargets) {
    if (availableTargets.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableTargets.length);
        setTargetWord(availableTargets[randomIndex]);
    }
}

// --- 5. (新機能) お題設定 (ノーマルモード) ---

function setNewNormalWord() {
    // 全リストから、正解済みのものを除外
    const availableTargets = ALLOWED_CLASSES.filter(
        word => !gameState.answeredWords.has(word)
    );
    
    if (availableTargets.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableTargets.length);
        setTargetWord(availableTargets[randomIndex]);
    } else {
        // 全問正解
        feedbackElement.textContent = '🎉 全問クリア！ 🎉';
        targetWordElement.textContent = "CLEAR!";
        gameState.targetWord = '---';
        typingInput.disabled = true;
        endGame(); // 時間が残っていても終了
    }
}


// --- 6. タイピング処理 ---

function setupInputListeners() {
    typingInput.addEventListener('input', () => {
        if (gameState.targetWord === '---' || !gameState.isGameRunning) return;

        const typedText = typingInput.value;

        if (typedText === gameState.targetWord) {
            // --- 正解処理 ---
            gameState.score++;
            scoreElement.textContent = gameState.score;
            feedbackElement.textContent = `⭕ 正解！「${gameState.targetWord}」`;
            
            // (新機能) 正解リストに追加
            gameState.answeredWords.add(gameState.targetWord);

            // 次のお題へ
            if (gameState.mode === 'camera') {
                detectObjects(true); // カメラモード: 即時再検出
            } else {
                setNewNormalWord(); // ノーマルモード: 次のランダム単語
            }

        } else if (gameState.targetWord.startsWith(typedText)) {
            feedbackElement.textContent = 'タイピング中...';
        } else {
            feedbackElement.textContent = '❌ ミス！打ち直してください。';
        }
    });

    // コピペ防止
    typingInput.addEventListener('paste', (e) => e.preventDefault());
    typingInput.addEventListener('copy', (e) => e.preventDefault());
    typingInput.addEventListener('cut', (e) => e.preventDefault());
    typingInput.addEventListener('contextmenu', (e) => e.preventDefault());
    typingInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'x' || e.key === 'X')) {
            e.preventDefault();
        }
    });
}


// --- 7. モーダル処理 ---

function populateClassList() {
    let htmlContent = '';
    for (const [english, japanese] of Object.entries(COCO_CLASSES)) {
        htmlContent += `<p><strong>${english}</strong>: ${japanese}</p>`;
    }
    classListContainer.innerHTML = htmlContent;
}

function setupModalListeners() {
    detailsButton.addEventListener('click', () => {
        detailsModal.style.display = 'block';
    });
    closeButton.addEventListener('click', () => {
        detailsModal.style.display = 'none';
    });
    window.addEventListener('click', (event) => {
        if (event.target == detailsModal) {
            detailsModal.style.display = 'none';
        }
    });
}

// --- アプリケーションの開始 ---
initializeApp();
