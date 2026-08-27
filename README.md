# 8th Wall OSS × A-Frame — Image Target サンプル

[![Deploy](https://github.com/noria901/styly-netsync-webar/actions/workflows/deploy.yml/badge.svg)](https://github.com/noria901/styly-netsync-webar/actions/workflows/deploy.yml)

**https://noria901.github.io/styly-netsync-webar/**

自前ホスティング前提の、画像マーカー WebAR 最小構成。マーカーを認識すると
カード + 回転オブジェクト + 軸ギズモが重なる。
STYLY NetSync と繋ぐとマルチプレイヤーになるが、そちらはオプトイン
（`?bridge=...`）なので、上記 URL をそのまま開けばシングルプレイヤーで動く。

エンジンバイナリはこのリポジトリに含めていない。8th Wall の限定利用ライセンス下に
あるため、ローカルでは README の手順で取得し、CI はビルド時に公式リポジトリから
取得する（`.github/workflows/deploy.yml`）。

デモ用のマーカーが1枚入っている（`image-targets/sample-target_original.png`）。
印刷するか画面に表示してカメラを向ければ動く。合成画像なので、
自分のマーカーに差し替えるのが前提。

---

## 1. セットアップ

```bash
npm install
```

### エンジンと 8-Frame を配置

MIT 版のリポジトリには SLAM が含まれていない。画像ターゲットは SLAM チャンクの上に
乗っているので、バイナリ配布版が必要。

公式サンプルの `external/` に一式入っているので、まとめて取るのが早い。
**Git LFS 必須**（`.gitattributes` で `external/**` が LFS 指定されている）:

```bash
git clone --depth 1 https://github.com/8thwall/aframe-image-targets-example /tmp/8w
cd /tmp/8w && git lfs pull && cd -
cp -r /tmp/8w/external/xr           public/external/
cp -r /tmp/8w/external/scripts      public/external/
cp -r /tmp/8w/external/landing-page public/external/
```

LFS を引き忘れると、120 バイトのポインタテキストが `xr.js` として配信されて
「なぜか何も起きない」状態になる。`head -1 public/external/xr/xr.js` が
`version https://git-lfs.github.com/spec/v1` なら引けていない。

`https://8thwall.org/downloads` の `xr-standalone.zip` でも同じものが取れる。

### 何が必要で、何が要らないか

`external/` 全体は LFS 実体で **36.4 MB**（63ファイル）あるが、画像ターゲットだけなら
大半は不要。実測した内訳:

| ファイル | サイズ | 画像ターゲットに必要 |
|---|---|---|
| `xr/xr.js` | 1.0 MB | 必要（コア） |
| `xr/xr-slam.js` | 5.4 MB | 必要（`data-preload-chunks="slam"`） |
| `scripts/8frame-1.5.0.min.js` | 1.3 MB | 必要 |
| `landing-page/landing-page.js` | 0.1 MB | 実質必要（非対応ブラウザ誘導） |
| `xr/xr-face.js` | 7.5 MB | 不要 |
| `xr/resources/*.tflite` | 6.4 MB | 不要（face / semantics モデル） |
| `xr/resources/*-worker.js` | 9.5 MB | 不要 |

**合計 7.7 MB**（gzip 後で概ね 2.3 MB 程度）。face effects や sky segmentation を
使わないなら、残り 28MB は削っていい。

なお **`.wasm` は1つもない**。エンジンは全部 JS で、SLAM も `xr-slam.js` という
ただの巨大な JS ファイル。前に「wasm の MIME 設定が要る」と書いたが、不要だった。

素の A-Frame 1.5.0 でも大体動くが、8-Frame にはリサイズまわりの修正が入っている。
差し替える場合は `index.html` の script src を書き換えて、ファイル名も合わせること。

---

## 2. マーカーを作る

```bash
npm run target      # = npx @8thwall/image-target-cli@latest
```

対話式。聞かれるのは5つ:

```
Enter the path to the image file:  ./targets/my-marker.png
Select the image type:             1) flat (default)  2) cylinder  3) cone
Use default crop? [Y/n]:           Y
Enter the output folder:           ./image-targets
Enter a name for the image target: sample-target
```

出力された JSON は `src/app.js` の glob が自動で拾う。ファイルを増やせば増やしただけ
読み込まれるので、コード側の編集は不要。

`index.html` の `image-target="name: sample-target"` の name は、CLI で入力した
**image target name** と一致させる。ファイル名ではなく JSON 内の `name` が正。

## マーカーの仕様

CLI のソース（`apps/image-target-cli/src/`）と、実際に生成した出力の実測。

### 入力の制約

`src/constants.json` と `crop.js` の `validateCrop` に書かれている条件:

| 項目 | 値 | 根拠 |
|---|---|---|
| クロップ後の最小幅 | **480 px** | `minimumWidth` |
| クロップ後の最小高さ | **640 px** | `minimumHeight` |
| デフォルトクロップ | **3:4（縦長）中央** | `getDefaultCrop` |
| 対応フォーマット | sharp が読めるもの（png / jpeg / webp / tiff 等） | `sharp(...).metadata()` |
| EXIF 回転 | 自動で正規化 | `rawImage.autoOrient()` |

制約は**クロップ後**にかかる。元画像がいくら大きくても、切り出した領域が
480×640 を下回ると `Invalid crop geometry` で落ちる。

デフォルトクロップは 3:4 に合わせて中央を切る。横長画像を渡すと左右が、
縦長すぎる画像を渡すと上下が捨てられるので、**構図の端に特徴を置かない**。

### 出力

1200×1600 の PNG を食わせた実測:

| ファイル | 実測サイズ | 用途 |
|---|---|---|
| `<name>.json` | 582 B | メタデータ |
| `<name>_luminance.png` | **480×640 グレースケール** | **実行時に使われるのはこれだけ** |
| `<name>_thumbnail.png` | 263×350 | UI 用 |
| `<name>_cropped.png` | クロップ後の原寸 | 再編集用 |
| `<name>_original.png` | 入力の原寸 | 再編集用 |

**エンジンが実際に追跡するのは 480×640 のグレースケール1枚**。
つまり入力を 4000px で用意しても情報は 480×640 に落とされる。
解像度を上げるより、この解像度で潰れない特徴を持たせる方が効く。

`luminanceHeight: 640` で高さ基準にリサイズしているので、
3:4 でないクロップだと幅は 480 にならない（例: 1:1 なら 640×640）。

### JSON の中身

```json
{
  "imagePath": "image-targets/sample-target_luminance.png",
  "name": "sample-target",
  "type": "PLANAR",
  "properties": {
    "left": 0, "top": 0, "width": 1200, "height": 1600,
    "isRotated": false, "originalWidth": 1200, "originalHeight": 1600
  },
  "resources": { ... }
}
```

`properties` は**元画像に対するクロップ矩形**であって、物理サイズではない。
実寸はどこにも入らない（だから `markerWidth` を自分で測って渡す必要がある）。

### `imagePath` の罠

`imagePath` は**ドキュメントからの相対 URL** で、エンジンは
`img.setAttribute('src', imagePath)` で読む（`tracking-controller.ts`）。

つまり **`dist/image-targets/<name>_luminance.png` が実在しないと動かない**。
JSON をバンドルしただけでは足りない。しかもこれを忘れると:

- ビルドは通る
- コンソールにもエラーが出ない（画像の onerror は握られている）
- **マーカーが一生認識されないだけ**

「マーカーが悪いのか」と延々画像を作り直すことになる典型。
`vite.config.js` にコピー用のプラグインを入れてあるので、
このリポジトリでは自動で `dist/` に入る（実行時に要らない
`_original` / `_cropped` / `_thumbnail` は除外、マーカー1枚あたり約 130KB の節約）。

### マーカー画像のコツ

480×640 グレースケールに落ちることを前提に:

- **非対称・非反復**。市松模様やロゴの繰り返しは特徴点が縮退する
- **コントラストが高く、細部の密度が均一**。480×640 で潰れる細線は無意味
- グラデーションと大きなベタ面には特徴点が出ない
- **色に頼らない**。グレースケール化されるので、赤と緑の対比は消える
- 印刷するなら光沢紙は避ける（ハイライトで飛ぶ）

### 円筒・円錐

`type` に `CYLINDER` / `CONICAL` を選ぶと `properties` が増える:

- 円筒: `cylinderCircumferenceTop` / `targetCircumferenceTop` / `arcAngle` / `unit`
- 円錐: 上記 + `topRadius` / `bottomRadius` / `coniness`

単位は `'mm' | 'in'` を持つがスケールフリーで、トラッキング挙動には影響しない。
円錐は内部で `unconify()` により平面に展開され、その展開後の画像に対して
クロップがかかる（README の cone-diagram 参照）。

---

## 3. 動かす

```bash
npm run dev
```

`https://<PCのLAN IP>:5173/` にスマホでアクセス。自己署名証明書なので警告は「詳細」→
「アクセスする」で抜ける。カメラは HTTPS necessário なので `http://` では動かない。

---

## 4. 座標系

マーカーにバインドされたエンティティのローカル座標は:

- 原点 = 印刷画像の中心
- +Z = 紙面から手前（マーカーの法線方向）
- スケール = マーカーの印刷幅が 1 ユニット

なので `position="0 0 0.3"` はマーカー幅の 0.3 倍だけ浮く、という意味になる。
実寸に依存しないので、A4 に印刷しても名刺サイズに印刷しても見た目の比率は同じ。

`axis-helper` を出しているのは、この向きが直感と合っているか確認するため。慣れたら消す。

---

## 5. イベント

エンジンは scene に対して発火する。ターゲットが複数あっても同じイベントが来るので、
`detail.name` で必ず振り分ける。

| イベント | タイミング | detail |
|---|---|---|
| `xrimagefound` | 初めて認識した | `{name, position, rotation, scale}` |
| `xrimageupdated` | 追跡中、毎フレーム | 同上 |
| `xrimagelost` | フレームから外れた | 同上 |

`detail.rotation` は **クォータニオン**。オイラー角ではないので `object3D.quaternion.copy()`
で受ける。`src/app.js` の `image-target` コンポーネントがこれをラップして、
エンティティ側に `targetfound` / `targetlost` を再送出している。

### マーカーを外しても残す（persist）

```html
<a-entity image-target="name: sample-target; persist: true; persistTimeout: 0">
```

SLAM が動いていれば、最後に認識した位置に空間固定されたまま残る。
`disableWorldTracking` のデフォルトは `false` なので、明示的に切らない限り有効
（ソース: `tracking-controller.ts` の `disableWorldTracking_ = false`）。
切ってしまうと空間参照がなくなり、コンテンツがカメラに追従する。

素朴に実装すると2箇所で破綻するので、`src/image-target.js` で対処してある。

#### 1. 最後のフレームで固めてはいけない

`xrimagelost` の detail は **`name` しか持たない**。姿勢は付いてこないので、
自分で保持しておいた値で固めることになる。ここで「最後に受け取ったサンプル」を
使うと、目に見えて傾く。

ロスト直前の数フレームは常に最悪の品質だから:

- マーカーが斜めになっていく（浅い角度ほど姿勢推定が不安定）
- フレーム外に出かかっている
- 手が動いているのでモーションブラーが乗る

直近20サンプルを保持し、**スコアが最良のものを選んで固める**ようにした。

スコアは推定を劣化させる2要因から作る:

```
facing = dot(マーカー法線, マーカー→カメラ方向)   // 正対で 1、真横で 0
jitter = 前フレームからの移動量[m]

score = facing - min(1, jitter * 4)
        （facing < 0.42、つまり65度より浅い場合は facing を半分に）
```

ロストのシミュレーション（正対 → 75度まで傾けながらフレームアウト、
全フレームに位置3mm・角度0.4度の基本ノビイズ）で比較:

| | 位置誤差 | 角度誤差 |
|---|---|---|
| 最終フレームで固める | 0.675 m | 82.4° |
| 最良サンプルで固める | 0.002 m | 0.1° |

ノイズシードを200通り振っても **200勝0敗**、角度誤差の改善は中央値 426倍、
最悪でも 257倍。詳細は `bridge/test/persist-test.mjs`。

#### 2. 再認識でスナップさせない

固定中は SLAM のドリフトが溜まる。マーカーを再び認識した瞬間に実姿勢へ代入すると、
その分が一気にジャンプして見える。

350ms かけて smoothstep で補間するようにした
（`t*t*(3-2t)`。両端で速度が不連続にならない）。

#### その他

- **`persistTimeout`**（秒、0 で無期限）。ドリフトは溜まり続けるので、
  10分前に固定した姿勢はもう嘘。長時間セッションでは切った方がいい
- **エンティティは `<a-scene>` の直下に置く**。姿勢はワールド空間で報告されるので、
  親に変換が乗っていると二重適用になる。ネストしていると警告を出す
- HUD 用のイベントを出す: `targetfound` / `targetlost`（`detail.persisting` 付き） /
  `persistexpired`。コンポーネント側は HUD を知らない

  **これらは bubble させること。** A-Frame の `emit(name, detail, bubbles)` は
  デフォルト `true` だが、`false` を渡すとそのエンティティ止まりになり、
  `<a-scene>` 側のリスナーが一切発火しない。しかもコンポーネント自体は
  正常に動くので、**HUD だけが更新されない**という気づきにくい壊れ方をする。

## テスト

```bash
npm test
```

ブラウザなしでコンポーネントを検証する。`bridge/test/aframe-stub.mjs` が
A-Frame と THREE の最小スタブで、実物の `emit(name, detail, bubbles)` の
bubbling 挙動を再現している（そこが壊れやすいので）。

`bridge/test/image-target.test.mjs` が検証している内容:

- `targetfound` / `targetlost` / `persistexpired` が**シーンのリスナーに届く**
- `persist: false` ならロスト時に非表示、`true` なら表示のまま
- ロスト時に**正対フレームで固まる**（斜めの最終フレームではなく）
- 別名のマーカーのイベントを無視する
- 再認識でスナップせず補間される
- `persistTimeout` で消える
- `<a-scene>` 直下でないときに警告する

CI でも `npm run build` の前に走る。

---

## 6. ビルドと配信

```bash
npm run build     # → dist/
```

`dist/` を静的ホスティングに置くだけ。**HTTPS 必須**（カメラが secure context を要求する）。
特殊な MIME 設定は要らない（wasm を使っていないため）。

**シングルプレイヤーなら GitHub Pages で完結する。** 公式サンプル自体が
Pages 用の Actions ワークフローを同梱していて、`actions/checkout@v4` に
`lfs: true` を指定して `npm run build` → `upload-pages-artifact` という構成。
そのまま流用できる。

帯域の目安（初回ロード 2.3 MB、Pages のソフトリミット 100GB/月 に対して）:

| 初回ロード数 | 転送量 | ソフトリミット比 |
|---|---|---|
| 500 | 1.1 GB | 1.1% |
| 2,000 | 4.5 GB | 4.5% |
| 10,000 | 22.6 GB | 22.6% |

イベント規模なら余裕。ただし GitHub Pages の利用規約は商用サイトのホスティングを
想定していないので、クライアントワークで使うなら Netlify / Cloudflare Pages の方が
筋がいい。

---

## 制約

- **SLAM は OSS ではない**。バイナリ配布版のみ（商用可、限定利用ライセンス）
- **VPS / Maps / Hand Tracking はバイナリにも含まれない**
- MIT で公開されているのは Image Targets / Face Effects / Sky Effects と周辺ツール
- ホスト版で公開済みの体験は 2027-02-28 まで動く。それ以降はセルフホスト必須

## 参考

- エンジン本体・CLI: https://github.com/8thwall/8thwall
- セルフホスト移行ガイド: https://www.8thwall.com/docs/migration/self-hosted/
- A-Frame 公式サンプル: https://github.com/8thwall/aframe-image-targets-example

---

# STYLY NetSync と組み合わせる

NetSync は「全員が同じ座標系にいる」ことを前提にポーズを配る。その前提を誰が作るか、
という部分は NetSync 自身のスコープ外で、LBE では通常キャリブレーション治具や
会場固定のアンカーが担当する。

画像マーカーはそこにそのまま嵌る。同じ紙を全員がスキャンすれば共有原点が決まる。
8th Wall の VPS がバイナリ版から外れた今、WebAR 側で使える現実的な共有原点は
実質これしかない。

```
   printed marker  ──────┐
                         │  (each client derives the same origin)
   Quest / XREAL  ───────┼──►  NetSync server (ZMQ ROUTER + PUB)
                         │            ▲
   phone browser  ───────┘            │  DEALER / SUB
        │                             │
        └── WebSocket ──►  bridge/  ──┘
```

## ファイル

| ファイル | 役割 |
|---|---|
| `src/colocalization.js` | マーカー姿勢 → 共有メトリック空間への変換 |
| `src/netsync-client.js` | ブラウザ側 NetSync クライアント（WebSocket） |
| `src/netsync-aframe.js` | A-Frame グルー。`netsync-colocalized` コンポーネント |
| `bridge/server.js` | WebSocket ↔ ZeroMQ ブリッジ |
| `bridge/codec.js` | **要実装。** ワイヤフォーマットのエンコード/デコード |

## 使い方

```bash
cd bridge && npm install && npm start
```

`index.html` の `<a-scene>` に:

```html
netsync-colocalized="anchor: sample-target;
                     markerWidth: 0.2;
                     url: wss://192.168.1.10:8787;
                     room: venue-a"
```

マーカーを認識して30フレーム平均を取り終えた時点で latch し、`colocalized` イベントを
発火してサーバに接続する。以降マーカーはフレームから外れてよく、SLAM が原点を運ぶ。

---

## 設計上の判断ポイント

### 1. スケールは実測値で上書きする

`detail.scale` はエンジンが SLAM から推定したマーカー幅。**デバイス間で数%ずれる。**
同じ A4 を Pixel と iPhone でスキャンして 0.19 m と 0.21 m が出る、というのが普通に起きる。

複数デバイスが同じ座標系を共有する以上、これは許容できない。定規で測った実寸を
`markerWidth` に渡すと、`colocalization.js` が `knownWidth / detail.scale` で補正して
真のメートルに揃える。ここを省くと「だいたい合っているが微妙にずれる」という、
一番デバッグしづらい壊れ方をする。

### 2. latch してから走る

毎フレーム原点を再計算すると、マーカー姿勢のジッタがそのまま自分のアバターの
震えになって全クライアントに配信される。30フレーム分を平均して固定し、あとは
SLAM に任せる。ドリフトが溜まったら `realign()` で取り直す。

クォータニオンの平均で `dot < 0` のときに符号反転しているのは、同じ回転でも半球が
逆だと slerp が遠回りするため。ここを飛ばすと平均が明後日の方向を向く。

### 3. 利き手系の変換

three.js は右手系、Unity は左手系。Z 反転で:

- 位置 `(x, y, -z)`
- クォータニオン `(-x, -y, z, w)`

反射 `M = diag(1,1,-1)` による共役 `MRM` は、軸 `Ma` まわりの角度 `-θ` の回転になる
（`det M = -1` なので符号が反転する）ため。往復変換は数値誤差 1e-15 オーダーで一致する
ことを確認済み。

Unity 側でアバターが鏡像になっていたら、まずここを疑う。

### 4. 量子化は 1cm（レンジは事実上無制限）

ここは前に誤解していたので訂正。`binary_serializer.py` を読むと:

| 対象 | 型 | スケール | レンジ |
|---|---|---|---|
| head 絶対位置 | int24 | `ABS_POS_SCALE = 0.01` | ±83,886 m |
| 手・virtual（**head 相対**） | int16 | `REL_POS_SCALE = 0.005` | ±163.84 m |
| physical / XR origin delta | int16 | `LOCO_POS_SCALE = 0.01` | ±327 m |

README にある「0.005 m/unit、±163.84 m」は **head 相対**の手・virtual の話で、
head の絶対位置ではない。head は int24 の 1cm 刻みなので、会場サイズがレンジを
問題にすることはない。原点をどこに置くかは自由。

効いてくるのは**精度側**で、位置は 1cm に丸められる。マーカー姿勢の平均化を
サブミリまで追い込んでも、ワイヤに乗る時点で 1cm に落ちる。

回転は smallest-three 圧縮で uint32。最大成分の符号は送られず正として復元されるので、
`q` と `-q` は同一視される（同じ回転なので実害なし）。

### 5. ポートは4つ、レーンは2本

`default.toml` と `server.py` を読んだ結果:

| ポート | 種類 | 用途 |
|---|---|---|
| 5555 | ROUTER | control — hello / RPC / NV / ownership |
| 5557 | ROUTER | **transform — pose 専用の別レーン** |
| 5556 | PUB | ルーム配信 |
| 8800 | HTTP | REST bridge（FastAPI） |
| 9999 | UDP | サーバディスカバリ |

pose は 5555 ではなく **5557** に送る。リファレンスの Python クライアントも
DEALER を2本（control + transform）と SUB を1本の計3ソケット開いている。
1本にまとめると control ハンドラに落ちて、transform 状態が一切更新されない。

**ZMQ identity はクライアント識別子ではない。** これは自分が誤解していた点で、
`_handle_client_transform` を読むと分かるとおり、サーバは**ペイロード内の deviceId**で
クライアントを引く。identity はサーバ→クライアントの unicast 経路として、
`control_identity` / `transform_identity` にレーン別で保持されるだけ。

とはいえブラウザごとにソケット対を分ける必要はある（戻り経路が要るため）。
`deviceId` を localStorage に永続化しているのは、room 内のクライアント状態が
device_id キーで管理されていて、リロードのたびに新規 ID を振るとゴーストが増えるから。

### 7. SUB のトピックは前方一致（実測で確認）

`topic_bytes = room_id.encode("utf-8")` をそのまま PUB のトピックにしている。
ZMQ SUB は**前方一致**なので、`venue` を購読すると `venue-a` も `venue-b` も届く。

実際に `sub.subscribe('venue')` だけして待つと、`venue-a` のフレームが流れてきた:

```
frames=4 topics=venue-a
```

リファレンスクライアントはこれを知っていて、受信後に
`if topic == room_id_bytes` とバイト厳密比較で弾いている。ブリッジも同じ処理を入れた。
ルーム名を互いのプレフィックスにしない運用も併せて。

なおオブジェクト同期は `room_id + b"\x00obj"` を別トピックにしているが、
これも room_id が前方一致するので同じ購読で拾える。

### 8. 生存条件は「pose を送り続けること」

`client_timeout = 5.0`。そして `last_update` を更新するのは
`_handle_client_transform` **だけ**。RPC を投げ続けても延命されない。

見るだけの WebAR クライアント（アバターを出したくない）は、pose を投げるのではなく
**stealth モード**を使う。`CLIENT_HELLO_FLAG_STEALTH` を立てた hello を control レーンに
1Hz で送り続ける方式で、`STEALTH_HEARTBEAT_INTERVAL` として実装されている。
ブリッジは `join` 時に `stealth: true` を渡すとこの動作になる。

### 9. 送信レートは 10Hz でいい

`transform_broadcast_rate = 10`。サーバの再配信が 10Hz なので、それより速く送っても
coalesce で捨てられるだけ。前に 15Hz にしていたのは無駄だったので 10 に落とした。

### 6. プロトコルバージョンは 8

`binary_serializer.py` の `PROTOCOL_VERSION = 8`。`codec.js` はこれに合わせて
実装済みで、Python 側の `serialize_*` とバイト単位で一致することを確認してある
（hello / pose / stealth pose / RPC、および ROOM_POSE のデコード）。

バージョン不一致は `_deserialize_client_hello` が `ValueError` を投げ、
`deserialize()` が握り潰して `(type, None, b"")` を返す。サーバは警告ログを出して
フレームを捨てるが、**クライアントには何も返らない**。つまり静かに何も起きなくなる。
サーバを上げたあと同期が止まったら、まずここを疑う。

なおソース中のコメントには "protocol v5 compact format" と書かれた箇所が残っている。
古いだけなので、定数を信じること。

---

## さらに踏み込むなら

NetSync v5 の reference-frame-local pose は、動くプラットフォーム上のポーズを
親フレーム相対で送る仕組み。マーカーは本質的に reference frame そのものなので、
マーカーを frame として登録し、クライアント側で world 変換せずに frame 相対のまま
送る、という構成が取れるはず。

利点は、後からマーカーの設置位置を動かしてもコンテンツ側の座標を触らなくて済むこと。
複数マーカーを別々の frame にすれば、会場を分割して各エリアにローカル原点を持たせる
運用もできる。フォーマット側の対応状況は要確認。

---

## リポジトリを読んで判明した、設計に影響する事実

前回まで推測で書いていた部分の訂正を含む。

### REST bridge がすでに存在し、CORS が全開（実測済み）

`rest_bridge.py` は FastAPI で、`server.py` の起動時に **無条件で** `0.0.0.0:8800` に立つ
（`enable_server_discovery` のような無効化フラグはない）。しかも:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    ...
)
```

つまり**ブラウザから直接叩ける**。Client Variables / Global Variables については
ブリッジすら不要:

```
POST /v1/rooms/{room_id}/devices/{device_id}/client-variables
GET  /v1/rooms/{room_id}/global-variables
GET  /logs/export
```

WebAR 側で「マーカーで確定した原点のスケール値をルームに共有する」程度なら、
Global Variables を fetch で書くだけで済む。

ただし実際に動かして分かった注意点が2つある。

**書き込みは即時反映されない。** POST のレスポンスは `{"state":"queued"}` で、
直後に GET すると `{"variables":{}}` が返る。読めるようになるまで実測で約1秒。
`RoomBridge` が内部クライアント経由で非同期に flush する設計のため。
read-after-write は成立しないので、書いた値を確認してから次に進む作りにはできない。

**REST に書くとルームに幽霊クライアントが1体増える。** `RoomBridge` は
それ自体が stealth の NetSync クライアントで、最初の書き込み時に接続する:

```
NetSync client started: tcp://127.0.0.1:5555, ... room=venue-a
Assigned client number 2 to device ID 02df6f71... in room venue-a
Status: 1 rooms, 1 normal clients, 1 stealth clients
```

clientNo を1つ消費し、device ID mapping にも載る。ルームごとにキャッシュされるので
リクエストごとに増えはせず、stealth なので `ROOM_POSE` には現れない（実際の
クライアントからは #1 しか見えていないことを確認済み）。とはいえ clientNo を
数えるロジックを書くなら踏む。

裏返すと、**認証が一切ない**。コードベース全体を grep しても CURVE も ZAP も
トークン検証もない。ZMQ ポートも平文。同一 LAN にいれば誰でも任意のルームの変数を
読み書きできる。接続したことのない device ID に対しても
`mapping: {"clientNo": null}` で受理されるので、事前に値を仕込むこともできる。

`/logs/export` は `--log-dir` を付けて起動した場合のみ有効（未設定なら 404）。
有効にすると、こちらも認証なしで読める。

会場ネットワークを閉じる前提の設計なので、WebAR で「来場者のスマホのブラウザ」を
入れるということは、その端末を信頼境界の内側に入れるということになる。
ゲスト SSID からブリッジ経由でのみ触らせる方が安全。

### ディスカバリは UDP ブロードキャスト

`server_discovery_port = 9999` の UDP。ブラウザは UDP を扱えないので、
WebAR クライアントがサーバを自動発見することは原理的にできない。
アドレスは設定で渡すか、ブリッジ側が発見した結果を WebSocket 経由で伝えるしかない。

### 「マーカーを reference frame として登録する」は無理だった

前回、`POSE_FLAG_MOVING_FLOOR_LOCAL` を見て「マーカーを参照フレームにできるのでは」と
書いたが、ソースを読むと違った。

このフラグが切り替えるのは `physical` レーンの解釈だけで、
`ENCODING_PHYSICAL_IS_XRORIGIN_DELTA`（XR Origin からの差分）と
「動く床のローカル座標」を入れ替える。**head の位置は常にルーム絶対座標**で、
どのフラグの組み合わせでも相対にはできない。

なので co-localization はクライアント側で完結させるしかない。今の実装（マーカーで
原点を latch してから絶対座標に変換して送る）が、プロトコルの範囲では正しい形。

### 手・virtual は head 相対で、head 必須

`_serialize_client_body` に明示的に:

```python
# Relative transforms require head as anchor.
if (flags & POSE_FLAG_HEAD_VALID) == 0:
    flags &= ~(POSE_FLAG_RIGHT_VALID | POSE_FLAG_LEFT_VALID | POSE_FLAG_VIRTUALS_VALID)
```

head を送らずに手だけ送ることはできない。stealth フレームは逆に、
transform 系のビットが全部落とされる（`flags = POSE_FLAG_STEALTH`）。

WebAR クライアントは基本 head のみなので `virtualCount = 0` で終端する。
タップした指先などを送りたい場合は virtual transform（最大50）に載せる。

### ROOM_POSE は差分ではなく毎回フルスナップショット

`serialize_room_transform` はルーム内クライアントを毎回全部詰める。
落ちたクライアントは「消える」のではなく「含まれなくなる」ので、
受信側は merge ではなく作り直す。`netsync-client.js` の `remotes` を毎回 clear
しているのはこのため。

### transform 帯域にトークンバケットがある

`TRANSFORM_BUDGET_BYTES_PER_SEC = 15_000_000`。`len(message) * sub_count` を消費する
方式なので、**接続クライアント数に対して二次で効く**。1クライアント約 30 バイトとして
50人なら 10Hz で 30 × 50 × 50 × 10 = 750KB/s 程度、まだ余裕はあるが、
virtual transform を積むと一気に伸びる。

---

## 検証内容

### ユニット: Python 実装とのバイト一致

- `serialize_client_hello`（通常 / stealth）→ バイト一致
- `serialize_client_transform`（head あり / stealth）→ バイト一致
- `serialize_rpc_message` → バイト一致
- 上記を `deserialize()` に通して全て受理されることを確認
- サーバが生成した `ROOM_POSE`（2クライアント、うち1つは右手つき）を `decode()` で
  復元し、位置・回転・手の相対位置が正しく戻ることを確認

座標変換（`colocalization.js`）は three.js 実測で往復誤差 2.3e-15、
マーカー自身が原点・単位クォータニオンに落ちること、
マーカー +Z 方向が Unity forward（`z = -0.5`）になることを確認済み。

### 統合: 実サーバに対する疎通

サンドボックス内で `styly-netsync-server 0.17.4` を起動し、
ブリッジ経由でヘッドレスクライアント3台（通常2 + stealth 1）を接続して確認した。

```
server (pyzmq 27.2.0 / libzmq 4.3.5)  :5555 :5556 :5557 :8800
   ↑ ZeroMQ
bridge (node + zeromq.js)             :8787
   ↑ WebSocket
fakeclient × 3
```

確認できたこと:

- 3台とも入室し clientNo 1/2/3 を取得。サーバ側 `Status: 2 normal clients, 1 stealth clients`
- pose が往復。半径2.0mと3.5mの円運動を送り、受信側で
  `#1@[-1.94,1.60,0.48]`（半径 2.00）`#2@[-1.13,1.60,3.31]`（半径 3.50）を復元
- Y=1.60 が正確に往復（1cm 量子化の範囲内）
- RPC のブロードキャストが他2台と自分自身に到達、`argumentsJson` も正しく復元
- stealth クライアントは `ROOM_POSE` を受信するが**自分は含まれない**（#1 #2 のみ）
- pose 送信を止めた5秒後に `Client web-a... removed (timeout)` を確認。
  `client_timeout = 5.0` の実測どおり

### 実行して初めて分かった穴

制御レーンには pose と RPC 以外に3種類のメッセージが常時流れていて、
最初の実装はこれを全部 `unhandled` で捨てていた:

| type | 内容 | 落とすと困ること |
|---|---|---|
| 6 `DEVICE_ID_MAPPING` | clientNo ↔ deviceId | **ピアを名前で特定できない** |
| 8 `GLOBAL_VAR_SYNC` | ルーム変数の同期 | 変数変更に追従できない |
| 10 `CLIENT_VAR_SYNC` | クライアント変数の同期 | 同上 |

特に 6 は重要で、これ以外に clientNo と deviceId を結びつける経路がない。
`ROOM_POSE` は clientNo しか持たないので、これを捨てると
「誰のアバターか」が永久に分からない。デコーダを追加して再実行し、
`unhandled` がゼロになることと、mapping が正しく出ることを確認した:

```
[a] mapping: #1=web-a #2=web-b #3=web-c(stealth)
```

`DEVICE_ID_MAPPING` にはバージョンバイトがなく、代わりに3バイトのサーバ
バージョンが直接続く点に注意（他の多くのメッセージと構造が違う）。

### 検証できていないこと

以下は**サンドボックス内では確認不能**:

- 8th Wall エンジン本体（`xr-standalone.zip` は取得できず、カメラもない）
- 実際のマーカー認識、`detail.scale` が実機でどれだけばらつくか
- SLAM のドリフト量と latch 後の実用時間
- 実機ブラウザでの wss / mixed content まわり
- 端末間のクロックずれが `poseTime` の扱いに与える影響

つまり **ネットワークスタックは実証済み、AR 部分は未検証**。
`colocalization.js` の数学は数値的には正しいが、実際のマーカーデータを
一度も通していない。

---

# ホスティング構成

静的な部分と、常駐プロセスが要る部分で話が完全に分かれる。

```
┌─────────────────────────────────────────┐
│ 静的ホスティング  ← GitHub Pages で OK   │
│   index.html / app.js / xr.js /          │
│   image-targets/*.json                   │
└─────────────────────────────────────────┘
                  │ wss
┌─────────────────▼───────────────────────┐
│ 常駐プロセス  ← Pages では絶対に無理     │
│   NetSync server (Python)                │
│   bridge (Node)                          │
└─────────────────────────────────────────┘
```

## 1ビルドで両方やる

「NetSync が無ければシングルプレイヤーになる」実装にしておけば、
**同じ成果物を Pages に置いたまま、会場では マルチで動く**。

ただし「繋ぎに行って失敗したら諦める」ではなく、**マルチをオプトイン**にする。
設定はクエリ文字列で渡す:

```
https://you.github.io/webar/                                  → シングル
https://you.github.io/webar/?bridge=wss://venue.example.com/ws&room=venue-a
                                                              → マルチ
```

会場の QR にだけパラメータを埋める。この差は地味に効く:

- **試行して劣化**方式だと、会場外で開いた人全員がダイヤルのタイムアウトを
  待たされてから AR が始まる。しかも 99% の実行経路がエラー処理側になる
- **オプトイン**なら、通常ケースはネットワーク呼び出しゼロ。
  マーカーを認識した瞬間に AR が始まる

フォールバック自体は残す。ただし対象は「会場の QR は正しいがブリッジが落ちている」
ケースだけ。この場合は黙ってシングルプレイヤーに落ちる。

### 実装上の要点

```js
// src/netsync-aframe.js
export function readMultiplayerConfig(search = window.location.search) {
  const bridge = new URLSearchParams(search).get('bridge')
  if (!bridge) return null                       // ← ここで即シングル
  if (location.protocol === 'https:' && bridge.startsWith('ws://')) {
    return null                                  // ← mixed content を事前に弾く
  }
  ...
}
```

`ws://` を https ページから開こうとすると、ブラウザによっては
`new WebSocket()` が同期的に throw する。I/O が始まる前に弾いて、
理由をログに出しておく方が事故調査が早い。

**接続タイムアウトは必須。** 到達できないホストへの WebSocket は fast fail しない。
プラットフォーム次第で OS の TCP タイムアウトまで SYN 再送を続けるので、
スマホだと「接続中」の HUD を数十秒眺めることになる。4秒で切っている。

**リトライは有限回。** 会場の Wi-Fi は落ちるのでリトライ自体は要るが、
存在しないブリッジに対する無限リトライは、バッテリーとコンソールを食い潰すだけ。
指数バックオフで4回試して諦める設計にした。

上のセクションの帯域見積もりのとおり、静的配信はイベント規模なら無料枠で足りる。

## マルチプレイヤーだと詰まるのは「証明書」

NetSync と組むと途端に厄介になる。理由は帯域でも CPU でもなく、
**HTTPS ページから LAN 内の WebSocket に繋げない**こと。

- カメラを使うのでページは HTTPS 必須
- HTTPS ページからは `ws://` が mixed content でブロックされる → `wss://` 必須
- `wss://192.168.1.10:8787` に有効な証明書は、公的 CA からは取れない
- 自己署名だと WebSocket は**警告画面すら出さずに黙って失敗する**
  （ページと違って「詳細 → アクセスする」のフローがない）

つまり Pages にページを置いた瞬間、LAN 内のブリッジには繋がらなくなる。
実質的な選択肢は3つ。

### A. ページも会場サーバから配る（開発・小規模向け）

Pages を使わず、ブリッジと同じマシンから `vite preview` なり nginx なりで配る。
自己署名証明書を一度ブラウザで受け入れれば、同じオリジンの `wss://` も通る。

一番簡単。ただし来場者全員に証明書警告を踏ませることになるので、
社内テストや小規模の実験まで。

### B. 実ドメイン + DNS-01 で LAN IP に証明書を出す（本番向け）

`venue.example.com` の A レコードをプライベート IP（例 `192.168.1.10`）に向け、
DNS-01 チャレンジで Let's Encrypt の証明書を取る。HTTP-01 と違って
インバウンドの 80 番が要らないので、閉じた会場ネットワークでも通る。

Caddy なら DNS プロバイダのプラグインを入れて数行:

```
venue.example.com {
    reverse_proxy /ws* localhost:8787
    root * /srv/webar/dist
    file_server
}
```

証明書が正規なので警告なし、ページとブリッジが同一オリジンになるので
mixed content も起きない。**本番はこれが素直。**

注意点として、公開 DNS がプライベート IP を返す構成は
DNS リバインディング対策でフィルタされることがある（一部のルータや
フィルタリング DNS）。会場の DNS を自前で持つか、来場者に配る Wi-Fi の
リゾルバを指定しておくと確実。

### C. トンネル（Cloudflare Tunnel など）

手軽だが、**LBE には向かない**。会場内で完結するはずのヘッドポーズが
インターネットを往復することになり、10Hz でも体感できる遅延とジッタが乗る。
会場のアップリンクが落ちたら全部止まるというのも、現地運用としては弱い。

デモや遠隔からの動作確認には便利。

## 会場サーバのスペック

サンドボックスで実測（idle → 20クライアント接続）:

| プロセス | RSS | CPU |
|---|---|---|
| NetSync server | 51 → 53 MB | 数% |
| bridge (Node) | 65 → 71 MB | 数% |

合わせて **RSS 120MB 台**、CPU もほぼ遊んでいる。
`TRANSFORM_BUDGET_BYTES_PER_SEC = 15_000_000` に対して、
1クライアント約30バイト × 10Hz なので、帯域も相当先まで余裕がある
（ただし配信コストは `メッセージ長 × 購読者数` なので**人数の二乗で効く**）。

要するに **Raspberry Pi 5 クラスで十分足りる**。Python と Node が動いて、
HMD と同じセグメントにいて、証明書を持っていればいい。
持ち運べる箱に入れておくと、会場ごとにネットワーク屋と交渉しなくて済む。

なお計測ホストが 1 vCPU だったため、20クライアント同時起動時は
テストクライアント側が CPU を食い合って6台しか繋がりきらなかった。
サーバ・ブリッジ側の数値は信用していいが、**同時接続数の上限は測れていない**。

## ポートまとめ

| ポート | 誰が使う | 公開範囲 |
|---|---|---|
| 443 | ブラウザ（ページ + wss） | 来場者に開放 |
| 8787 | ブリッジ（リバースプロキシ経由） | localhost で十分 |
| 5555 / 5556 / 5557 | ZMQ（HMD ↔ サーバ） | **会場 LAN のみ** |
| 8800 | REST API | **会場 LAN のみ** |
| 9999/udp | ディスカバリ | 会場 LAN のみ |

ZMQ と REST は認証も TLS もないので、来場者の端末が乗るネットワークに
そのまま晒さないこと。来場者はゲスト SSID に置いて、443 だけ通す。
ブリッジがサーバと同じ箱にいれば、8787 も 5555〜5557 も外に出さずに済む。

---

## フォールバックの検証結果

3経路をヘッドレスで実測（`bridge/test/fallback-test.mjs`）。

| シナリオ | 結果 |
|---|---|
| `?bridge=` なし | **WebSocket 生成 0回**、即シングルプレイヤー |
| https ページ + `ws://` | I/O 前に拒否、警告ログのみ |
| ブリッジ稼働 | 1回で `online`、自分の clientNo とピア名を取得 |
| ブリッジ停止 | 5回試行して 12.0 秒で `offline`、以降は無音 |

停止時のタイムライン（指数バックオフ 800ms → 1.6s → 3.2s → 6.4s、
各ダイヤルに4秒のタイムアウト）:

```
connecting@0.0s -> connecting@0.8s -> connecting@2.4s
-> connecting@5.6s -> connecting@12.0s -> offline@12.0s
[netsync] running single-player — no bridge at ws://... after 4 attempts
```

12秒はマーカー認識**後**に始まるので、AR 自体は最初から動いている。

### 走らせて見つかったバグ2件

**1. 上りと下りでキーが食い違っていた。**
ブリッジは `{type: 'roomPose'}` を送るのに、クライアントは `switch (msg.t)` で
分岐していた。つまり**受信メッセージを1つも処理していなかった**。

e2e テストが通っていたのは、`fakeclient.mjs` が自前のパーサを持っていて
`msg.type` を見ていたから。テストダブルが本番コードを迂回していた典型で、
`remotes seen: 0` という「動いてるはずなのに数が合わない」出力で初めて気づいた。

修正後は `remotes seen: 1 / peers named: #1=web-peer #2=web-test / own clientNo: 2`。
`DEVICE_ID_MAPPING` を処理するようにしたので、自分の clientNo も分かるようになった
（それまでは `null` のまま、roomPose の自己除外が効いていなかった）。

なお `t`（上り）と `type`（下り）は**わざと別語彙のまま**にした。
前者はブリッジとの自前 WebSocket プロトコル、後者は NetSync フレームのデコード結果で、
統一すると片方を変えたときにもう片方が黙って壊れる。

**2. `error` イベント未処理。**
ブラウザでは `error` → `close` の順に発火してうるさいだけだが、Node の `ws` は
未処理の `error` で**プロセスごと落ちる**。Sentry のようなエラー収集を入れていると
ブラウザでも例外として上がる。リトライは `close` 側にあるので、
`error` は握って黙らせるだけでいい。

---

## 8th Wall ロゴを消す

**同じ見た目のものが2つある。** どちらも `position: fixed; bottom: 2%;` の
中央下なので、見ただけでは区別がつかない。片方だけ消しても残る。

| セレクタ | 描いているもの | 出る場面 | ライセンス |
|---|---|---|---|
| `.poweredby-img` | xrextras | ローディング画面、権限エラー画面、Android の link-out / copy-link、非対応ブラウザ画面 | MIT |
| `.poweredby-img-8w` | **エンジン本体** (`permissions-helper.ts`) | カメラ権限プロンプト、immersive 復帰プロンプト | エンジンバイナリのライセンス |

どちらも shadow DOM を使わず DOM に直接挿さるので、CSS が普通に届く。
`src/hud.css` で両方消してある:

```css
.poweredby-img    { display: none; }   /* xrextras (MIT) */
.poweredby-img-8w { display: none; }   /* エンジン本体 */
```

エンジン側は `permissions-helper.ts` が `<style>` を `document.head` に
`prepend` して、`ResourceUrls.resolvePoweredLogo()`
（= `resources/powered-by.svg`）を `<img>` で挿している。
CSS で消せるが、これはエンジンが自分で描いているもの。

### ライセンスについて

xrextras は MIT。MIT が要求するのは**ソース配布時に著作権表示を残すこと**であって、
UI にロゴを表示し続けることではない。`.poweredby-img` を消すのは問題ない。

`.poweredby-img-8w` はエンジンバイナリのライセンス下で、
`public/external/xr/LICENSE` に同梱されている。**消す前にそこを読むこと。**
法律の判断はこちらではできないので、そこは自分でやってほしい。
戻すなら `hud.css` の該当ブロックを消すだけ。

なお `packages/engine/README.md` には、xr.js 自体を MIT のソースから自前ビルドして
SLAM チャンク（`xr-slam.js`）だけバイナリを使う手順も載っている。
「work in progress」と注意書き付きだが、本体側を自由にしたい場合の道はある。

### ローディング画面ごと自前にする場合

`xrextras-loading` を外せばロゴも一緒に消えるが、**カメラ権限まわりの UI も消える**。
iOS / Android それぞれの権限拒否時の復帰手順を出してくれるもので、
自前で書くと地味に大変。ロゴを消したいだけなら CSS で足りる。

---

## オフラインで動かす（`file://` は無理）

### なぜ `file://` ではダメか

カメラは問題ない。`file://` は仕様上 **secure context に含まれる**ので、
`getUserMedia` 自体は通る。

詰まるのはモジュールの読み込み。エンジンは SLAM チャンクを
**動的 import** で取りに行く（`chunk-loader.ts`）:

```js
const slamChunk = await import(/* webpackIgnore: true */ url)
```

`file://` ページのオリジンは `null` なので、これは CORS で拒否される。
Worker（`new Worker(workerUrl)`）も同じ理由で作れない。
どちらもバイナリの中なので、こちら側で直しようがない。

自分のコードを IIFE 1ファイルにまとめても、この2つは残る。

### 代わりに: PWA（実装済み）

Service Worker で **https オリジンを保ったまま全部キャッシュから配る**。
ネットのある場所で一度開けば、以降はオフラインで動く。

```bash
npm run build      # dist/sw.js が自動生成される
npm run test:sw    # ビルドして Service Worker を検証
```

- プリキャッシュ一覧は **`dist/` の実物から生成**する。手書きリストのように
  ビルド結果とズレることがない
- キャッシュ名は全ファイルの内容ハッシュ。何か変われば新しい名前になり、
  それが更新のトリガーになる
- `addAll` ではなく個別 fetch。`addAll` は atomic なので1つ 404 が混じると
  **何もキャッシュされず、インストール自体が失敗する**
- cache-first。エンジンは約 8MB の不変ブロブなので、毎回検証する意味がない
- ナビゲーションはシェルにフォールバック（ディープリンクでオフラインページを
  出さないため）

**xrextras は CDN 参照をやめてローカルに置いた。** クロスオリジンのスクリプトは
opaque response になり、プリキャッシュしても意味がないため。CI がビルド時に
jsDelivr から取得して `public/external/scripts/xrextras.js` に置く。

`manifest.webmanifest` を入れてあるので、「ホーム画面に追加」で
フルスクリーン起動になる。

### そのほかの手

**端末上で HTTP サーバを立てる。** Termux で `python3 -m http.server 8080` して
`http://localhost:8080` を開く。**localhost は secure context** なので全部動く。
ネットワークは不要。手軽だが、来場者に配る形ではない。

**WebView でくるむ。** Capacitor などは内部的に `https://localhost` 相当の
スキームから配信するので、secure context の条件を満たす。APK として配れるので、
すでに APK のビルド・配布の仕組みがあるなら、これが一番運用しやすいかもしれない。
