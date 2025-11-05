// --- DOM要素の取得 ---
// (共通)
const statusElement = document.getElementById('status');
const detailsButton = document.getElementById('detailsButton');

// (モード選択画面)
const modeSelection = document.getElementById('modeSelection');
const startCameraButton = document.getElementById('startCameraButton');
const startNormalButton = document.getElementById('startNormalButton');

// (ゲーム画面)
const gameArea = document.getElementById('gameArea');
const webcam = document.getElementById('webcam');
const gameCanvas = document.getElementById('gameCanvas'); // (追加)
const targetWordElement = document.getElementById('target-word');
const typingInput = document.getElementById('typing-input');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const feedbackElement = document.getElementById('feedback');
const stopButton = document.getElementById('stopButton'); // (追加)

// (モーダル)
const detailsModal = document.getElementById('detailsModal');
const closeButton = document.getElementsByClassName('closeButton')[0];
const classListContainer = document.getElementById('classListContainer');

// --- 定数とゲーム状態 ---
const GAME_DURATION = 60;
const DETECTION_INTERVAL_MS = 2000; // (追加) 検出間隔
const DETECTION_THRESHOLD = 0.6;   // (追加) 検出の信頼度

let model;
let targetWord = '';
let score = 0;
let time = GAME_DURATION;
let gameInterval;
// let detectionInterval; // (rAFに変更するためコメントアウト)
let stream = null; 
let isGameRunning = false;

// ▼▼▼ (新機能) ゲーム状態管理の追加 ▼▼▼
let gameMode = 'camera'; // 'camera' or 'normal'
let answeredWords = new Set(); // 正解済みの単語 (重複防止用)
let ctx = gameCanvas.getContext('2d');
let predictions = []; // Canvas描画用の検出結果
let modelLoaded = false;
let cameraInitialized = false;
let rAFHandle; // requestAnimationFrameのハンドル

// --- 1. 初期化とモデルロード ---

// (元の stopCamera は変更なし)
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        webcam.srcObject = null;
        cameraInitialized = false;
    }
}

// (元の initializeApp を変更)
async function initializeApp() {
    statusElement.textContent = 'カメラとAIモデルを準備中です...';
    startCameraButton.disabled = true;
    startNormalButton.disabled = true;
    detailsButton.disabled = true;

    try {
        // (新機能) カメラとモデルのロードを並行して行う
        const modelPromise = cocoSsd.load().then(m => {
            model = m;
            modelLoaded = true;
        });

        const cameraPromise = navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        })
        .then(s => {
            stream = s;
            webcam.srcObject = stream;
            return new Promise(resolve => webcam.onloadedmetadata = resolve);
        })
        .then(() => {
            // (新機能) Canvasのサイズをビデオに合わせる
            gameCanvas.width = webcam.videoWidth;
            gameCanvas.height = webcam.videoHeight;
            cameraInitialized = true;
        });

        await Promise.all([modelPromise, cameraPromise]);
        
        statusElement.textContent = '準備完了！モードを選択してください。';
        startCameraButton.disabled = false;
        startNormalButton.disabled = false;
        detailsButton.disabled = false;
        
        populateClassList();
        
    } catch (error) {
        console.error('初期化に失敗しました:', error);
        statusElement.textContent = 'エラー: カメラを許可し、ページをリロードしてください。';
    }
}

// --- 2. ゲームのリセットと開始 ---

// (元の resetGame を変更)
function resetGame() {
    clearInterval(gameInterval);
    // clearInterval(detectionInterval); // (rAFに変更)
    cancelAnimationFrame(rAFHandle); // (rAF) ループ停止
    
    score = 0;
    time = GAME_DURATION;
    targetWord = '---';
    isGameRunning = false;
    answeredWords.clear(); // (新機能) 重複防止リストをクリア
    predictions = []; // (新機能) Canvas描画をクリア

    scoreElement.textContent = score;
    timerElement.textContent = time;
    targetWordElement.textContent = targetWord;
    
    typingInput.value = '';
    typingInput.disabled = true;
    feedbackElement.textContent = '';
    
    // (新機能) Canvasをクリア
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
}

// (元の startGame を大幅に変更)
function startGame(mode) {
    if (isGameRunning || !modelLoaded) return;
    
    // (新機能) カメラモードでカメラが初期化されていなければ開始しない
    if (mode === 'camera' && !cameraInitialized) {
        statusElement.textContent = 'カメラの準備ができていません。';
        return;
    }
    
    resetGame(); // 先にリセット
    isGameRunning = true;
    gameMode = mode;

    // UIの更新 (モード選択 -> ゲーム)
    modeSelection.style.display = 'none';
    gameArea.style.display = 'block';
    
    typingInput.disabled = false;
    typingInput.focus();

    // ゲームタイマー開始
    gameInterval = setInterval(() => {
        time--;
        timerElement.textContent = time;
        if (time <= 0) {
            endGame();
        }
    }, 1000);
    
    // (新機能) モードごとに処理を分岐
    if (gameMode === 'camera') {
        gameCanvas.style.display = 'block'; // Canvasを表示
        detectObjects(true); // 即座に最初の検出とお題を設定
        rAFHandle = requestAnimationFrame(gameLoop); // (rAF) ループ開始
        statusElement.textContent = 'ゲーム開始！カメラに映るものを入力してください。';
    } else {
        gameCanvas.style.display = 'none'; // Canvasを非表示
        setNewNormalWord(); // (新機能) ノーマルモードのお題を設定
        statusElement.textContent = 'ゲーム開始！表示されるお題を入力してください。';
    }
}

// --- 3. 物体検出 (rAFループとCanvas描画) ---

// (新機能) rAFベースのゲームループ
let lastDetectionTime = 0;
async function gameLoop(timestamp) {
    if (!isGameRunning) return;

    // 描画 (毎フレーム)
    drawDetections();

    // 検出 (一定間隔)
    if (timestamp - lastDetectionTime > DETECTION_INTERVAL_MS) {
        lastDetectionTime = timestamp;
        await detectObjects(false); // 通常の検出
    }

    rAFHandle = requestAnimationFrame(gameLoop); // 次のフレーム
}

// (新機能) Canvas描画
function drawDetections() {
    // (重要) 非表示のwebcamからCanvasへ映像を転写
    ctx.drawImage(webcam, 0, 0, gameCanvas.width, gameCanvas.height);
    
    ctx.font = '16px Arial';
    ctx.lineWidth = 3;

    // (重複防止) 既に正解したものは描画しない (お題を除く)
    const predictionsToDraw = predictions.filter(
        p => !answeredWords.has(p.class) || p.class === targetWord
    );

    predictionsToDraw.forEach(p => {
        // お題の色分け
        const color = (p.class === targetWord) ? '#E91E63' : '#00FFFF';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        ctx.beginPath();
        ctx.rect(p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
        ctx.stroke();
        
        ctx.fillRect(p.bbox[0], p.bbox[1], p.bbox[2], 20); // ラベル背景
        ctx.fillStyle = '#000000';
        ctx.fillText(`${p.class} (${Math.round(p.score * 100)}%)`, p.bbox[0] + 5, p.bbox[1] + 15);
    });
}


// (元の detectObjects を修正)
async function detectObjects(forceNewWord = false) {
    if (!model || !stream || !isGameRunning) return;

    const allPredictions = await model.detect(webcam);
    
    // 描画用に保存
    predictions = allPredictions.filter(p => p.score > DETECTION_THRESHOLD);
    
    // (重複防止) 検出されたクラス (ユニーク)
    const detectedClasses = new Set(predictions.map(p => p.class));
    
    // (重複防止) 検出リストから、既に正解したものを除外
    const availableTargets = [...detectedClasses].filter(
        word => !answeredWords.has(word)
    );

    if (availableTargets.length > 0) {
        statusElement.textContent = `${availableTargets.length}種類のお題候補を検出中。`;
        
        // (お題持続) お題が '---' か、正解直後(forceNewWord) の場合のみ、新しいお題を設定
        if (forceNewWord || targetWord === '---') {
            setNewTargetWord(availableTargets);
        }
    } else if (targetWord === '---') { // (お題持続) お題が既にある場合は、見失っても '---' に戻さない
        statusElement.textContent = 'お題が見つかりません。カメラに何か映してください。';
        targetWord = '---';
        targetWordElement.textContent = targetWord;
    }
}

// --- 4. お題の設定 ---

// (共通化) お題を設定する関数
function setTargetWordCommon(newWord) {
    targetWord = newWord;
    targetWordElement.textContent = targetWord;
    feedbackElement.textContent = '新しいお題です！「' + targetWord + '」';
    typingInput.value = ''; // (自動クリア)
    typingInput.focus();
}

// (元の setNewTargetWord を修正)
function setNewTargetWord(detectedClasses) {
    if (detectedClasses.length > 0) {
        const randomIndex = Math.floor(Math.random() * detectedClasses.length);
        setTargetWordCommon(detectedClasses[randomIndex]);
    } else {
        // (重複防止) 検出中のものが全て正解済みの場合
        statusElement.textContent = '検出中のお題は全てクリアしました！';
        targetWord = '---';
        targetWordElement.textContent = '---';
    }
}

// (新機能) ノーマルモード用のお題設定
function setNewNormalWord() {
    // (重複防止) 全リストから、正解済みのものを除外
    const availableTargets = ALLOWED_CLASSES.filter(
        word => !answeredWords.has(word)
    );
    
    if (availableTargets.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableTargets.length);
        setTargetWordCommon(availableTargets[randomIndex]);
    } else {
        // 全問正解
        feedbackElement.textContent = '🎉 全問クリア！ 🎉';
        targetWordElement.textContent = "CLEAR!";
        targetWord = '---';
        typingInput.disabled = true;
        endGame(); // 時間が残っていても終了
    }
}


// --- 5. タイピング処理 ---
typingInput.addEventListener('input', () => {
    if (targetWord === '---' || !isGameRunning) return;
    const typedText = typingInput.value;

    if (typedText === targetWord) {
        // --- 正解処理 ---
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = `⭕ 正解！「${targetWord}」`;
        
        // (重複防止) 正解リストに追加
        answeredWords.add(targetWord);
        
        // (新機能) モードごとにお題を再設定 (setTargetWordCommonが呼ばれ自動クリアされる)
        if (gameMode === 'camera') {
            detectObjects(true); // forceNewWord = true で次のお題へ
        } else {
            setNewNormalWord();
        }
        
    } else if (targetWord.startsWith(typedText)) {
        feedbackElement.textContent = 'タイピング中...';
    } else {
        feedbackElement.textContent = '❌ ミス！打ち直してください。';
    }
});

// (元のコピペ禁止処理は変更なし)
typingInput.addEventListener('paste', (e) => e.preventDefault());
typingInput.addEventListener('copy', (e) => e.preventDefault());
typingInput.addEventListener('cut', (e) => e.preventDefault());
typingInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V' || e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
    }
});


// --- 6. ゲーム終了 ---

// (元の endGame を修正)
function endGame() {
    isGameRunning = false;
    clearInterval(gameInterval);
   V  cancelAnimationFrame(rAFHandle); // (rAF) ループ停止
    
    statusElement.textContent = `ゲーム終了！スコア: ${score}点でした。「モード選択」ボタンで戻れます。`;
    alert(`ゲーム終了！あなたのスコアは ${score}点です。`);
    
    typingInput.disabled = true;
    // resetGame() は呼ばない (stopButtonが押された時にリセット)
}

// (新機能) モード選択に戻る
function returnToModeSelection() {
    if (isGameRunning) {
        endGame(); // 実行中ならまず終了
    }
    resetGame(); // 状態をリセット
    
    // UIの切り替え
    gameArea.style.display = 'none';
    modeSelection.style.display = 'block';
    statusElement.textContent = 'モードを選択してください。';
}


// --- 7. イベントリスナー ---

// (元の startButton をモード選択用に変更)
startCameraButton.addEventListener('click', () => startGame('camera'));
startNormalButton.addEventListener('click', () => startGame('normal'));
stopButton.addEventListener('click', returnToModeSelection);

// ページを離れる際にカメラを停止
window.addEventListener('beforeunload', stopCamera);


// --- 8. モーダル処理 (変更なし) ---
function populateClassList() {
    let htmlContent = '';
    for (const [english, japanese] of Object.entries(COCO_CLASSES)) {
        htmlContent += `<p><strong>${english}</strong>: ${japanese}</p>`;
    }
    classListContainer.innerHTML = htmlContent;
}
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

// アプリケーションの開始
initializeApp();
