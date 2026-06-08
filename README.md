# Larix WebRTC Live

Larix Broadcaster から WHIP で Ubuntu server に映像を送り、Web ページから WHEP/WebRTC で視聴する最小構成です。

## 構成

- `app`: 標準ポート `${APP_PORT:-7031}` の管理ページ、視聴ページ、WHIP/WHEP 代理サーバー
- `mediamtx`: Larix の WebRTC 入力とブラウザ視聴用のメディアサーバー
- `caddy`: `https://your-domain.example/` の HTTPS リバースプロキシ、自動証明書更新

Larix の WebRTC は WHIP で送信します。視聴側は WHEP で MediaMTX から受信します。
WebRTC の ICE 候補に Docker 内部IPが混ざるのを避けるため、Compose は host network で起動します。

## 起動

```bash
cd larix-webrtc
cp .env.example .env
# .env の ADMIN_TOKEN と PUBLISH_TOKEN は必ず長いランダム文字列に変更してください
docker compose up -d --build
```

## 常時起動

Docker コンテナには `restart: unless-stopped` を設定済みです。さらにサーバー再起動後も Web ページと MediaMTX を自動起動したい場合は、systemd サービスを登録します。

```bash
cd /home/takodango/videoliveserver/larix-webrtc
bash install-systemd.sh
```

登録後は、Ubuntu server の再起動後も以下が自動で立ち上がります。

- 視聴ページ: `https://your-domain.example/`
- 管理ページ: `https://your-domain.example/admin.html`
- ブラウザ配信ページ: `https://your-domain.example/publish.html`
- Larix 受信用 WHIP endpoint
- 視聴者向け WHEP/WebRTC endpoint

状態確認:

```bash
systemctl status larix-webrtc.service
docker compose ps
```

停止:

```bash
cd /home/takodango/videoliveserver/larix-webrtc
docker compose stop
```

自動起動を無効化:

```bash
sudo systemctl disable --now larix-webrtc.service
```

開くページ:

- 視聴者: `http://your-domain.example:${APP_PORT:-7031}/`
- 管理者: `http://your-domain.example:${APP_PORT:-7031}/admin.html`
- ブラウザ配信: `http://your-domain.example:${APP_PORT:-7031}/publish.html`

HTTPS 化後:

- 視聴者: `https://your-domain.example/`
- 管理者: `https://your-domain.example/admin.html`
- ブラウザ配信: `https://your-domain.example/publish.html`

管理画面に入ると、上部のボタンから配信ページと視聴ページへ移動できます。`/publisher.html` も `/publish.html` へ転送されます。

## 視聴ページ

管理者は配信開始時にタイトル、表示メッセージ、視聴パスワードを設定します。視聴者は配信中だけ名前とパスワードを入力でき、パスワードが一致した場合だけ `視聴開始` から映像、コメント、視聴者一覧を見られます。

配信が停止している間、視聴ページは `配信準備中` と表示し、配信タイトルや表示メッセージは表示しません。名前とパスワード欄も入力できない状態でフェード表示されます。

視聴ページには、左側にライブ映像、右側にコメント、現在の視聴者一覧、過去に見ていた視聴者一覧が表示されます。

視聴ページ、管理画面、ブラウザ配信ページにはサーバー到達指標が表示されます。`サーバー: 到達中` はMediaMTXの `live` パスに映像が届いている状態、`未到達` は配信受付中でもまだ映像が届いていない状態、`確認不可` はMediaMTXのControl APIを読めていない状態です。

ブラウザ配信ページでは、設定ビットレートに対して実測送信量が大きく下回る、送信キューが詰まる、RTTが大きい、またはブラウザが帯域/CPU制限を検知した場合に `ラグ: 注意` と表示します。不足が数秒続く場合は、配信を止めずに送信上限を一時的に下げます。視聴ページと管理画面にも、この直近の配信者側ラグ状態が表示されます。

視聴者の入退室履歴とコメントは `data/audience.json` に保存されます。RTMP で配信している場合も、視聴者は同じ WebRTC 視聴ページを見るため、コメントと視聴者履歴は同じように使えます。

管理画面で `配信停止` を押すと、そのライブ中のコメントと視聴者履歴は過去ライブとして保存され、視聴ページの現在のコメント/履歴はリセットされます。管理画面の `過去のライブ` から、終了済みライブごとの視聴者とコメントを確認できます。

## DNS

`your-domain.example` の `A` レコードをサーバーのグローバル IP に向けます。

Cloudflare などの DNS/CDN を使う場合、標準では `${WEBRTC_ICE_PORT:-8189}/udp` をそのまま通す必要があるため、まずはプロキシを使わず DNS only で設定してください。

LAN内から `your-domain.example` に接続できない場合は、ルーターがNATループバックに対応していない可能性があります。その場合は公開DNSはグローバルIPのままにして、LAN内DNSだけ `your-domain.example -> 192.168.1.10` にします。ブラウザではIP直打ちではなく、必ず `https://your-domain.example/` で開きます。ホスト名が `your-domain.example` のままなので、HTTPS証明書はそのまま有効です。

このリポジトリにはLAN内DNS用の `lan-dns` サービスがあります。

```bash
cd /home/takodango/videoliveserver/larix-webrtc
sudo docker compose --profile lan-dns up -d --build --remove-orphans
```

その後、ルーターのDHCP設定でLAN内端末に配るDNSサーバーを `192.168.1.10` にします。ルーター側でDNSサーバーを変えられない場合は、各端末のDNSを手動で `192.168.1.10` にしてください。確認はLAN内端末で以下を実行します。

```bash
nslookup your-domain.example 192.168.1.10
```

`Address: 192.168.1.10` が返ればOKです。

`https://192.168.1.10/` でも開けるように、Caddyの内部証明書を使う設定を入れています。これはLAN内用の証明書なので、端末によっては初回に証明書警告が出ます。警告なしで使うには、CaddyのローカルCAを端末に信頼させるか、`https://your-domain.example/` を使ってください。

LAN 内と外部回線の両方から使う場合、`.env` の `WEBRTC_ADDITIONAL_HOSTS` には両方を入れます。

```env
WEBRTC_ADDITIONAL_HOSTS=192.168.1.10,your-domain.example
```

## 開放が必要なポート

- `80/tcp`: HTTPS 証明書の自動取得・更新
- `443/tcp`: HTTPS の Web ページ、管理 API、WHIP/WHEP signaling
- `${APP_PORT:-7031}/tcp`: Web ページ、管理 API、WHIP/WHEP signaling
- `${WEBRTC_ICE_PORT:-8189}/udp`: WebRTC media
- `${WEBRTC_ICE_PORT:-8189}/tcp`: UDP が通らない環境向けの WebRTC fallback
- `${RTMP_PORT:-1935}/tcp`: RTMP で送信する場合

`${MEDIAMTX_WEBRTC_HTTP_PORT:-8889}` と `${MEDIAMTX_API_PORT:-9997}` はサーバー内部で使うだけなので、通常は外部公開しません。`${MEDIAMTX_API_PORT:-9997}` はMediaMTXのControl APIで、Web画面に表示するサーバー到達指標の取得に使います。
HTTPS 化後は通常アクセスでは `${APP_PORT:-7031}/tcp` を外部公開しなくても構いませんが、動作確認や切り戻し用に残しても動きます。

## Larix Broadcaster の設定

管理画面で「配信開始」を押してから、表示された `Larix WHIP URL` を Larix の WebRTC 接続 URL に設定します。

例:

```text
https://your-domain.example/whip?token=replace-with-a-long-random-publish-token
```

Larix 側の推奨:

- Video codec: H.264
- H.264 profile: Baseline または Main
- B-frames: 無効
- Audio codec: Opus

## RTMP で送信する場合

Larix を使わず、OBS Studio や RTMP 対応のスマホ配信アプリから送る場合は、管理画面で「配信開始」を押してから `RTMP URL` に送信します。

```text
rtmp://your-domain.example/live/rtmp
```

RTMP の音声は AAC で届くことが多く、そのままではブラウザの WebRTC 視聴で再生できない場合があります。この構成では RTMP を `/live/rtmp` で受け、音声だけ Opus に変換して視聴用の `/live` へ流します。映像は基本的にコピーされます。

標準ではRTMPから視聴用WebRTCへ流す前に `0.5` 秒の安定用ディレイを入れています。Blackmagic Cameraなどで一瞬の回線揺れがある場合に詰まりを少し吸収するためです。変更する場合は `.env` の `RTMP_STABILITY_DELAY` を変更します。

Moblin など、Server と Stream Key が分かれているアプリでは以下を使います。

```text
Server: rtmp://your-domain.example/live
Stream Key: rtmp
```

OBS Studio の例:

- Service: `Custom...`
- Server: `rtmp://your-domain.example/live`
- Stream key: `rtmp`

FFmpeg で Opus に変換した後の視聴用パスは内部で `/live` を使います。視聴者はこれまで通り `https://your-domain.example/` から WebRTC で見られます。

古い直接入力方式を使う場合、つまり `rtmp://your-domain.example:1935/live` に送る場合は、映像は見えても音声が WebRTC 視聴で捨てられることがあります。

OBS Studio から直接 `/live` に送る例:

- Service: `Custom...`
- Server: `rtmp://your-domain.example:1935/live`
- Stream key: 空欄

RTMP は送信側の互換性が高く、OBS Studio でも MediaMTX 公式の推奨送信方式です。

Android でオープンソースアプリを使う場合は、Roam Live が RTMP/SRT に対応しています。

## ブラウザから配信する場合

スマホ単体でアプリを入れずに配信する場合は、管理画面で「配信開始」を押してからブラウザ配信ページを開きます。

```text
https://your-domain.example/publish.html
```

ブラウザ配信ページ自体は HTTP でも開けます。ただし、カメラ、マイク、画面キャプチャの利用可否はブラウザの制限に従います。通常のスマホ/PCブラウザでは HTTPS が必要です。

ブラウザ配信ページでは以下を操作できます。

- レンズ選択
- マイク選択
- マイクON/OFF
- ズーム
- ピント距離
- 画面キャプチャ
- 音声ミュート
- 映像の一時停止
- 解像度
- フレームレート
- ビットレート
- 圧縮方式
- 端末内録画

iPhone のレンズ名、ズーム対応範囲、ピント距離は Safari が返すカメラ機能に依存します。非対応と表示される場合、その端末/ブラウザでは Web ページからの操作が公開されていません。
画面キャプチャは `getDisplayMedia` に対応したブラウザで使えます。Windows の Chrome/Edge、Android の対応ブラウザでは使える場合があります。iOS Safari ではWebページがOS標準の画面収録映像を直接受け取れないため、ブラウザ配信ページ単体では画面キャプチャ配信はできません。iOSで画面収録をライブ送信するには、ReplayKitのBroadcast Upload Extensionに対応したネイティブアプリが必要です。
画面キャプチャでは、キャプチャされた映像に含まれる音声と、選択したマイク音声をミックスして配信できます。マイク選択とマイクON/OFFは配信中にも切り替えられます。
解像度、フレームレート、ビットレート、圧縮方式は詳細設定に入っています。圧縮方式は `自動`、`H.264`、`VP8`、`VP9`、`AV1` から選べますが、実際に使える方式はブラウザと受信側の対応に依存します。配信中に変更した圧縮方式は次回の配信開始から反映されます。
録画設定では、配信とは別に録画用の解像度、フレームレート、ビットレートを選べます。録画は端末内のブラウザで作成され、停止後もブラウザ内の保存庫に残ります。`保存済み録画一覧` から後で読み込み、端末に保存/共有、または削除できます。iPhone では共有シートから `ビデオを保存` や `ファイルに保存` を選びます。標準の `高画質 カメラ直接` は、録画用にカメラを直接取得して保存します。端末やブラウザが配信と録画の同時カメラ利用を許可しない場合は、`互換 配信映像` に切り替えると、配信中の映像を端末内で録画できます。Safari のブラウザ内保存庫は通常の終了や再起動では残りますが、サイトデータ削除、プライベートブラウズ、端末の空き容量不足などでは消えることがあります。

## 管理画面の動き

- 配信開始: Larix からの WHIP 接続と視聴者の WHEP 接続を許可します。
- 配信停止: 新規接続を止め、サーバーが把握している Larix の送信セッションを終了します。

## HTTPS で使う場合

Caddy が `https://your-domain.example/` を受けて、内部の `127.0.0.1:${APP_PORT:-7031}` へ転送します。`${WEBRTC_ICE_PORT:-8189}/udp` と `${WEBRTC_ICE_PORT:-8189}/tcp` は MediaMTX へ届くようにしてください。

`.env` の例:

```env
PUBLIC_SCHEME=https
PUBLIC_HOST=your-domain.example
PUBLIC_HOSTNAME=your-domain.example
LAN_HTTPS_HOST=192.168.1.10
WEBRTC_ADDITIONAL_HOSTS=192.168.1.10,your-domain.example
APP_PORT=7031
WEBRTC_ICE_PORT=8189
RTMP_PORT=1935
RTSP_PORT=8554
MEDIAMTX_WEBRTC_HTTP_PORT=8889
MEDIAMTX_API_PORT=9997
ADMIN_TOKEN=replace-with-a-long-random-admin-token
PUBLISH_TOKEN=replace-with-a-long-random-publish-token
STREAM_NAME=live
RTMP_INGEST_NAME=live/rtmp
RTMP_OPUS_BITRATE=96k
RTMP_STABILITY_DELAY=0.5
RTMP_THREAD_QUEUE_SIZE=1024
```
