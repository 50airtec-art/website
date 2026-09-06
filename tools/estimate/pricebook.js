/* ==========================================================================
   空調王（空調工事 見積作成ツール） - 初期単価マスタ（仮の目安金額）
   --------------------------------------------------------------------------
   ここに書いてある金額は「とりあえずの目安」です。GitHub上に公開されます。
   実際の御社の単価は、ツールの［単価マスタ］画面で書き換えてください。
   書き換えた金額はブラウザ内（localStorage）にだけ保存され、
   このファイルやGitHubには一切書き込まれません。

   会社名・住所・社判も同じく、［自社情報］画面で設定した内容が
   その端末のブラウザにだけ保存されます。
   同じURLを別の会社の方が開いても、お互いの情報は見えません。
   ========================================================================== */

const DEFAULT_PRICEBOOK = {
  version: 7,

  /* ---------- 自社情報（見積書に印刷される / ［自社情報］画面で設定） ---------- */
  company: {
    name: '',
    owner: '',
    zip: '',
    address: '',
    tel: '',
    email: '',
    web: '',
    bank: '',
    invoiceNo: '',
    sealImage: '',     // 社判の画像（アップロードするとここに入る）
    sealSizeMm: 18,    // 社判の大きさ（mm）
    logoImage: '',     // ロゴの画像（アップロードするとここに入る）
    logoHeightMm: 12,  // ロゴの高さ（mm）
  },

  /* ---------- ワンタップ入力用のひな形（任意・追加してOK） ---------- */
  companyPresets: [
    {
      label: '50Airtec',
      name: '50Airtec（ゴーマルエアテック）',
      owner: '代表　五十嵐　透',
      zip: '〒991-0065',
      address: '山形県寒河江市中郷683-9',
      tel: '070-8969-7724',
      email: 'info@50airtec.com',
      web: 'https://50airtec.com/',
    },
  ],

  /* ---------- 見積書の既定文言 ---------- */
  defaults: {
    validDays: 30,
    taxRatePercent: 10,
    // 行の単価の端数。0＝そのまま／10＝10円未満は繰り上げ／100＝100円未満は繰り上げ
    unitRoundYen: 0,
    /* 1人工（1人が1日働く分）の金額。公共工事の考え方に合わせて、
       作業の項目には「人工」を持たせ、単価は［人工 × この金額］で出す。
       配管工でおおむね3万〜4万と言われる。実際の金額は［自社情報］で設定する。 */
    manDayYen: 30000,
    /* 原価の1人工。賃金＋法定福利費など、こちらが実際に出ていく金額。
       見積の1人工（manDayYen）との差が、そのまま作業の粗利になる。 */
    manDayCostYen: 0,
    /* 材料の仕入掛率（定価の何%で仕入れているか）。0なら未設定あつかい。
       項目ごとに原価を入れてあれば、そちらが優先される。 */
    materialCostPercent: 0,
    /* メーカー・シリーズごとの仕入掛率。
       商社は「メーカーごと、寒冷地モデルかどうか」で掛率を変えているので、
       材料ぜんぶを1つの率でまとめられない。
       { maker:'日立', series:'寒さ知らず', percent:24 } のように書く。
       series を空にすると、そのメーカーの機器ぜんぶに当たる。
       ここに当たらないものは、上の materialCostPercent を使う。 */
    costRates: [],
    /* 機種の見積金額の出し方。
         定価 × 仕入掛率 ＝ 原価　→　原価 ÷ この数 ＝ 見積に出す金額
       0.65 なら粗利率35%。0 や空なら効かせない（定価そのまま）。
       会社によって乗せる利益が違うので、［自社情報］で変えられる。 */
    modelSellDivisor: 0.65,
    overheadPercent: 0,
    paymentTerms: '工事完了後、月末締め翌月末払い',
    deliveryTerms: 'ご発注後、別途打合せ',
    footerNote: '※本見積は現地状況により変更となる場合があります。\n※記載のない工事・部材は含まれておりません。',
  },

  /* ---------- 単価マスタ ---------- */
  categories: [
    {
      id: 'unit',
      name: '機器本体',
      items: [
        { name: '機器本体（型番を入力）', spec: '', unit: '台', price: 0 },
        { name: '室内機', spec: '', unit: '台', price: 0 },
        { name: '室外機', spec: '', unit: '台', price: 0 },
        { name: 'リモコン（別売）', spec: '', unit: '個', price: 0 }
      ]
    },
    {
      id: 'home',
      name: '家庭用｜取付・交換',
      work: true,          // ここから入れた行は「作業費」として数える（消耗品雑費の計算のもと）
      items: [
        /* 取付・入替。まずここから拾う */
        { name: '標準取付工事', spec: '〜4.0kW（6〜14畳）', unit: '台', price: 16000, color: '緑' , est: 1 },
        { name: '標準取付工事', spec: '4.0〜6.3kW（14〜20畳）', unit: '台', price: 22000, color: '緑' , est: 1 },
        { name: '標準取付工事', spec: '6.3kW超（20畳以上・単相200V）', unit: '台', price: 28000, color: '緑' , est: 1 },
        { name: '入替工事（取外し＋取付 同日）', spec: '', unit: '台', price: 24000, color: '緑' , est: 1 },
        { name: '既存機 取外し', spec: '', unit: '台', price: 8000, color: '灰' , est: 1 },
        /* 配管まわり。長さ、化粧、そして壁の穴 */
        { name: '配管延長', spec: '標準4mを超える分', unit: 'm', price: 3000, color: '水' , est: 1 },
        { name: '配管化粧カバー（屋外）', spec: '', unit: 'm', price: 3000, color: '水' , est: 1 },
        { name: '配管化粧カバー（屋内）', spec: '', unit: 'm', price: 4000, color: '水' , est: 1 },
        { name: '化粧カバー 曲がり・ジョイント', spec: '', unit: '箇所', price: 1500, color: '水' , est: 1 },
        { name: '壁貫通穴あけ（木造・モルタル）', spec: '', unit: '箇所', price: 5000, color: '茶' , est: 1 },
        { name: '壁貫通穴あけ（ALC・コンクリート）', spec: '', unit: '箇所', price: 12000, color: '茶' , est: 1 },
        /* 電気まわり */
        { name: '電圧切替（100V ⇔ 200V）', spec: '', unit: '式', price: 5000, color: '桃' , est: 1 },
        { name: '専用コンセント新設', spec: '分電盤からの配線含む', unit: '式', price: 16000, color: '桃' , est: 1 },
        { name: 'コンセント交換（形状変更）', spec: '', unit: '箇所', price: 4000, color: '桃' , est: 1 },
        /* 室外機を、どこに、どう据えるか */
        { name: '室外機 立ち下ろし（1階置き）', spec: '', unit: '台', price: 5000, color: '紫' , est: 1 },
        { name: '室外機 壁面金具設置', spec: '', unit: '台', price: 12000, color: '紫' , est: 1 },
        { name: '室外機 屋根置き設置', spec: '', unit: '台', price: 15000, color: '紫' , est: 1 },
        { name: '室外機 二段置き金具', spec: '', unit: '台', price: 14000, color: '紫' , est: 1 },
        { name: '室外機 天吊り金具', spec: '', unit: '台', price: 18000, color: '紫' , est: 1 },
        { name: '防振ゴム・据付ブロック', spec: '', unit: '台', price: 3000, color: '紫' , est: 1 },
        /* 現場の条件で足すもの */
        { name: 'ドレンポンプ設置', spec: '', unit: '台', price: 18000, color: '水' , est: 1 },
        { name: '真空引き・ガスチャージ追加', spec: '', unit: '式', price: 6000 , est: 1 },
        { name: '高所作業（2階以上・脚立不可）', spec: '', unit: '式', price: 10000, color: '紫' , est: 1 },
        { name: '出張費', spec: '寒河江市から車で1時間圏外', unit: '式', price: 5000 , est: 1 },
        /* 自動で入る分 */
        { name: '消耗品雑費', spec: '', unit: '式', price: 0, autoPercent: 5, autoBase: 'work' },
      ]
    },
    {
      id: 'biz',
      name: '業務用｜天カセ・パッケージ',
      work: true,          // ここから入れた行は「作業費」として数える（消耗品雑費の計算のもと）
      items: [
        /* 機器の取付。室内機の形ごとに色を分けてある */
        { name: '天井カセット4方向 取付', spec: '1.5馬力', unit: '台', price: 90000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '2.0馬力', unit: '台', price: 100000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '2.5馬力', unit: '台', price: 110000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '3馬力', unit: '台', price: 120000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '4馬力', unit: '台', price: 140000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '5馬力', unit: '台', price: 160000, color: '青' , est: 1 },
        { name: '天井カセット4方向 取付', spec: '6馬力', unit: '台', price: 180000, color: '青' , est: 1 },
        { name: '天井吊形 取付', spec: '2〜3馬力', unit: '台', price: 100000, color: '赤' , est: 1 },
        { name: '天井吊形 取付', spec: '4〜6馬力', unit: '台', price: 140000, color: '赤' , est: 1 },
        { name: '床置形 取付', spec: '2〜3馬力', unit: '台', price: 90000, color: '緑' , est: 1 },
        { name: '壁掛形（業務用）取付', spec: '1.5〜2.5馬力', unit: '台', price: 70000, color: '橙' , est: 1 },
        /* 機器に付けるもの。天カセにも天吊形にも付く */
        { name: 'オートグリル 組み込み', spec: '', unit: '台', price: 20000, color: '青' , est: 1 },
        /* 建物側の仕込み。機器を吊る前に要る */
        { name: '下地補強（吊ボルト・アンカー）', spec: '', unit: '台', price: 12000, color: '茶' , est: 1 },
        { name: '点検口 新設', spec: '450角', unit: '箇所', price: 15000, color: '茶' , est: 1 },
        { name: '天井開口・復旧', spec: '', unit: '箇所', price: 20000, color: '茶' , est: 1 },
        /* 配管まわり */
        { name: '冷媒配管 新設', spec: '被覆銅管・保温込み', unit: 'm', price: 6000, color: '水' , est: 1 },
        { name: '冷媒配管 既設流用（洗浄・フラッシング）', spec: '', unit: '式', price: 25000, color: '水' , est: 1 },
        { name: 'ドレン配管 新設', spec: '', unit: 'm', price: 3000, color: '水' , est: 1 },
        { name: 'ドレンアップポンプ', spec: '', unit: '台', price: 25000, color: '水' , est: 1 },
        { name: '配管化粧カバー（屋外）', spec: '', unit: 'm', price: 4000, color: '水' , est: 1 },
        /* 電気まわり */
        { name: '電源工事（単相200V）', spec: 'ブレーカー増設含む', unit: '式', price: 30000, color: '桃' , est: 1 },
        { name: '電源工事（三相200V）', spec: 'ブレーカー増設含む', unit: '式', price: 45000, color: '桃' , est: 1 },
        /* 足場・重機。日いくらで数える */
        { name: '高所作業車 使用', spec: '', unit: '日', price: 40000, color: '紫' , est: 1 },
        { name: 'ユニック・クレーン 使用', spec: '', unit: '日', price: 50000, color: '紫' , est: 1 },
        { name: '足場設置・解体', spec: '', unit: '式', price: 60000, color: '紫' , est: 1 },
        /* 引き渡しまで */
        { name: '試運転・調整・取扱説明', spec: '', unit: '式', price: 10000 , est: 1 },
        { name: '養生・残材処分', spec: '', unit: '式', price: 15000 , est: 1 },
        /* 自動で入る分 */
        { name: '消耗品雑費', spec: '', unit: '式', price: 0, autoPercent: 5, autoBase: 'work' },
      ]
    },
    {
      id: 'move',
      name: '移設・取外し・処分',
      work: true,          // ここから入れた行は「作業費」として数える（消耗品雑費の計算のもと）
      items: [
        /* 家庭用。外して、運んで、捨てるまで */
        { name: '家庭用 取外しのみ', spec: '', unit: '台', price: 8000, color: '灰' , est: 1 },
        { name: '家庭用 移設（同一建物内）', spec: '取外し＋再取付', unit: '台', price: 30000, color: '緑' , est: 1 },
        { name: '家庭用 移設（別建物・運搬含む）', spec: '', unit: '台', price: 38000, color: '緑' , est: 1 },
        { name: '家電リサイクル料（エアコン）', spec: '', unit: '台', price: 2000, color: '灰' , est: 1 },
        { name: '収集運搬料', spec: '', unit: '台', price: 3000, color: '灰' , est: 1 },
        /* 業務用。フロンの回収と行程管理票が要る */
        { name: '業務用 取外しのみ', spec: '天カセ・パッケージ', unit: '台', price: 40000, color: '灰' , est: 1 },
        { name: '業務用 移設', spec: '取外し＋再取付', unit: '台', price: 120000, color: '緑' , est: 1 },
        { name: '業務用 廃棄処分', spec: 'フロン回収含む', unit: '台', price: 25000, color: '灰' , est: 1 },
        { name: 'フロン回収・行程管理票発行', spec: '', unit: '台', price: 8000, color: '灰' , est: 1 },
        /* 外したあとの後始末 */
        { name: '残置配管 撤去', spec: '', unit: '式', price: 8000, color: '灰' , est: 1 },
        { name: '壁穴 補修（パテ・キャップ）', spec: '', unit: '箇所', price: 3000, color: '茶' , est: 1 },
        { name: '壁穴 補修（造作・下地復旧）', spec: '', unit: '箇所', price: 12000, color: '茶' , est: 1 },
      ]
    },
    /* メーカーの材料（因幡電工・キヤッチャーなど）は、
       ［単価マスタ］→「CSVでまとめて取り込む」で読み込むと、
       CSVのカテゴリ列に書かれた名前のカテゴリが自動で作られる。
       そのため、ここに空の置き場をあらかじめ用意しておく必要はない。 */
    {
      id: 'other',
      name: 'その他・値引き',
      items: [
        /* 作業費 ＋ 消耗品雑費 の合計の15%を、ツールが自動で計算して入れる。
           この行を使うときは、見積画面の「諸経費（小計の%）」は0のままにしておく（二重取りになるため）。 */
        /* 消耗品雑費は家庭用・業務用にも置いてあるが、諸経費と並べて選べたほうが早いので
           ここにも置く。どこから入れても金額は同じ（作業費の合計の5%）。 */
        { name: '消耗品雑費', spec: '', unit: '式', price: 0, autoPercent: 5, autoBase: 'work' },
        { name: '諸経費（現場管理費）', spec: '', unit: '式', price: 0, autoPercent: 15, autoBase: 'work+auto' },
        { name: '駐車場代・通行料', spec: '', unit: '式', price: 0 },
        { name: '出精値引き', spec: '', unit: '式', price: 0 }
      ]
    }
  ]
};
