const webcam = document.getElementById('webcam');
const canvas = document.getElementById('gameCanvas'); // 使わないが残しておく
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
    'cup': 'コップ', 'book': '本', 'clock': '時計', 'keyboard': 'キーボード', 'cell phone': '携帯電話', 'mouse': 'マウス', 'bottle': 'ボトル', 
    'laptop': 'ノートパソコン', 'chair': '椅子', 'potted plant': '植木鉢', 'bed': 'ベッド', 'dining table': 'テーブル', 'remote': 'リモコン', 
    'handbag': 'カバン', 'tie': 'ネクタイ', 'suitcase': 'スーツケース', 'backpack': 'リュック', 'umbrella': '傘'
};

// ノーマルモード用の日本語単語リスト（短文・長文混合）
const JAPANESE_NORMAL_WORDS = [
    // 短文
    'さくら', 'たいよう', 'でんしゃ', 'きつね', 'たいふう',
    'りんご', 'みかん', 'がっこう', 'そら', 'うみ', 
    'かわ', 'ゆき', 'かぜ', 'ねこ', 'いぬ', 
    'さかな', 'とり', 'けいと', 'たいぴんぐ', 'ぷろぐらむ',
    // 長文
    '春の陽気に誘われて、公園の桜並木の下をゆっくりと散歩しました。',
    'プログラミング学習は毎日続けることが成功への鍵となります。',
    '今日の天気は晴れ時々曇りで、夕方からは少し冷え込む予報です。',
    '最新の技術動向を把握するために、毎日ニュースをチェックしています。',
    'タイピングの練習を通じて、入力速度を格段に向上させることができました。'
];


// --- 1. カメラとモデルの初期化 ---
async function setupCamera() {
    if (stream) return;
    
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        webcam.srcObject = stream;
        await new Promise(resolve => webcam.onloadedmetadata = resolve);

        if (!model) {
            statusElement.textContent = 'カメラ準備完了。モデルをロード中...';
            model = await cocoSsd.load();
        }
        
        statusElement.textContent = 'モデルロード完了！';
        
    } catch (error) {
        console.error('カメラの起動に失敗しました:', error);
        // カメラが起動できなくてもゲームは続行可能（ノーマルモード）
        statusElement.textContent = 'エラー: カメラを許可してください。';
    }
}

// カメラを停止する
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        webcam.srcObject = null;
        // カメラ映像を非表示にする
        webcam.style.display = 'none';
        canvas.style.display = 'none';
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

    gameInterval = setInterval(() => {
        time--;
        timerElement.textContent = time;
        if (time <= 0) {
            endGame();
        }
    }, 1000);
    
    if (gameMode === 'camera') {
        // カメラ映像を裏で動かすため起動
        setupCamera().then(() => {
            if (model) {
                // カメラモード: 3秒ごとに検出のみ行う
                detectionInterval = setInterval(detectObjects, 3000);
                detectObjects(true); // 即座に最初の検出とお題を設定
            } else {
                 statusElement.textContent = 'モデルがロードされていません。';
            }
        });
        // ユーザーに見せるUIはシンプルに保つため、映像は引き続き非表示 (index.htmlでstyle="display: none;")
        webcam.style.display = 'none';
        canvas.style.display = 'none';
        
    } else { // normal
        stopCamera();
        setNewTargetWord(); // ノーマルモードのお題を設定
        statusElement.textContent = 'ノーマルモードでプレイ中。';
    }
}

// --- 3. 物体検出 (カメラモード専用) ---
async function detectObjects(forceNewWord = false) {
    if (!model || !stream) {
        statusElement.textContent = 'カメラまたはモデルが利用できません。';
        return;
    }

    // カメラ映像から物体検出を実行
    const predictions = await model.detect(webcam);
    
    const detectedJapaneseWords = predictions
        .filter(p => p.score > 0.6 && JAPANESE_MAPPING[p.class])
        .map(p => JAPANESE_MAPPING[p.class]);

    if (detectedJapaneseWords.length > 0) {
        statusElement.textContent = `${detectedJapaneseWords.length}種類のお題候補を検出しました。`;
        
        // 強制出題 (ゲーム開始時) または現在のお題が画面内の物体にない場合に、新しいお題を設定
        if (forceNewWord || targetWord === '---' || !detectedJapaneseWords.includes(targetWord)) {
            setNewTargetWord(detectedJapaneseWords);
        }
    } else {
        statusElement.textContent = '物体が見当たりません。またはお題が見つかりません。';
    }
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
             feedbackElement.textContent = '全てのノーマル単語を出題しました！リストをリセットします。';
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
    if (targetWord === '---' || targetWord === '') return;

    const typedText = typingInput.value;
    
    if (typedText === targetWord) {
        // ⭕ 正解
        score++;
        scoreElement.textContent = score;
        feedbackElement.textContent = `⭕ 正解！「${targetWord}」`;
        
        // ！！修正箇所！！ タイピングが完了したら、入力欄をクリアし、カーソルを戻す
        typingInput.value = ''; 
        typingInput.focus();

        if (gameMode === 'camera') {
             // カメラモードでは検出に任せる
        } else {
             // ノーマルモードでは即座に次のお題を設定
             setNewTargetWord();
        }
        
    } else if (targetWord.startsWith(typedText)) {
        // 一致している
        feedbackElement.textContent = 'タイピング中...';
    } else {
        // ❌ ミス
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
        // カメラモード終了後、カメラを停止
        stopCamera();
    }
}

// --- 7. モード切り替えイベント ---
cameraModeBtn.addEventListener('click', () => {
    if (gameMode !== 'camera') {
        gameMode = 'camera';
        cameraModeBtn.classList.add('active-mode');
        normalModeBtn.classList.remove('active-mode');
        startGame();
    }
});

normalModeBtn.addEventListener('click', () => {
    if (gameMode !== 'normal') {
        gameMode = 'normal';
        normalModeBtn.classList.add('active-mode');
        cameraModeBtn.classList.remove('active-mode');
        stopCamera(); // カメラモードから切り替える際は停止
        startGame();
    }
});


// 初期起動
startGame();
