# 터미널 농장 설치 순서

> 이 문서는 **코딩 에이전트(클로드 코드 등)가 읽고 그대로 따라 하는** 설치 순서입니다.
> 사람이 읽어도 됩니다. 에이전트가 하는 일은 여기 적힌 것이 전부입니다.
> 직접 설치하려면 [README의 「직접 설치하기」](README.md#직접-설치하기)를 보세요.

## 에이전트에게 — 먼저 지킬 것

1. **시작하기 전에** 아래 1~6단계를 사용자에게 짧게 보여 주고 「이대로 진행할까요?」 허락을 받습니다.
2. 사용자의 설정 파일은 **4단계에서만**, **백업한 뒤**, **다시 묻고** 바꿉니다.
3. 여기 적힌 것 말고는 설치·삭제·변경하지 않습니다. 관리자 권한(sudo·관리자 창)이 필요한 일은 직접 하지 말고,
   명령을 보여 주고 사용자가 실행하게 합니다.
4. 막히면 다른 방법을 지어내지 말고, 무엇이 안 되는지 그대로 알려 줍니다.
5. 사용자는 개발자가 아닐 수 있습니다. 진행 상황은 쉬운 말로 짧게 알립니다.

아래에서 `<위치>` 는 2단계에서 정한 설치 폴더의 절대 경로입니다.

## 1. Node 확인

- `node -v` 가 **v22.13 이상**이면 2단계로 갑니다.
- 없거나 낮으면 설치를 안내하고, 허락을 받은 뒤 설치합니다.
  - 기본: https://nodejs.org 의 LTS 설치 파일(맥 `.pkg` · 윈도우 `.msi`).
  - 사용자가 이미 Homebrew(맥)나 winget(윈도우)을 쓰면 `brew install node` · `winget install OpenJS.NodeJS.LTS` 도 됩니다.
  - 설치한 뒤 **새 터미널**에서 `node -v` 를 다시 확인합니다.

## 2. 받기

- 기본 위치는 홈 폴더의 `terminal-farm` 입니다(맥 `~/terminal-farm`, 윈도우 `%USERPROFILE%\terminal-farm`).
  사용자가 다른 곳을 원하면 그곳에 받습니다.
- 그 폴더가 이미 있으면 **덮어쓰지 말고** 사용자에게 알립니다. 이미 설치된 것이면 업데이트(`git pull`)만 제안합니다.
- git 이 있으면: `git clone https://github.com/ceokobec-hue/terminal-farm.git <위치>`
- git 이 없으면: https://github.com/ceokobec-hue/terminal-farm/archive/refs/heads/main.zip 을 받아 풀고,
  풀린 폴더(`terminal-farm-main`)를 `<위치>` 로 옮깁니다.

## 3. 설치

`<위치>` 에서 `npm install` 을 실행합니다(1~2분, 인터넷 필요).

- 최근 npm(시험한 판 11.19)에서는 `npm warn install-scripts … esbuild … fsevents` 같은 **노란 경고**가 나올 수 있습니다.
  설치 때 자동으로 도는 작은 프로그램을 npm 이 일단 막아 뒀다는 안내이고, 막힌 채로도 농장은 정상으로 켜집니다.
  사용자에게 「고장이 아니라 정상 안내」라고 먼저 알리고, `npm install-scripts approve` 같은 승인은 하지 말고 그대로 다음 단계로 갑니다.

## 4. 딱 하나 묻기 — 정보 줄 연결

사용자에게 이렇게 묻습니다.

> 일꾼 아래에 모델·컨텍스트 % 정보 줄을 켤까요? 클로드 코드 설정 파일(settings.json)의 상태줄 항목을 바꿉니다.
> 바꾸기 전에 백업해 둡니다. 켜지 않아도 농장은 돌아가고, 그때 컨텍스트는 대화 기록으로 추정해서 보여 줍니다.

- **아니요** → 5단계로 갑니다.
- **예** →
  1. 설정 폴더는 환경 변수 `CLAUDE_CONFIG_DIR` 가 있으면 그 폴더, 없으면 홈의 `.claude` 입니다.
     그 안의 `settings.json` 을 같은 폴더에 `settings.json.bak-terminal-farm` 으로 복사합니다(파일이 없으면 새로 만듭니다).
  2. 명령 속 경로는 **절대 경로**로, 윈도우도 `/` 로 씁니다(예: `C:/Users/me/terminal-farm/scripts/statusline.mjs`).
  3. `statusLine` 항목이 **없으면** 이렇게 넣습니다.
     ```json
     "statusLine": { "type": "command", "command": "node \"<위치>/scripts/statusline.mjs\"" }
     ```
  4. `statusLine` 항목이 **이미 있으면**
     - 맥·리눅스: 원래 `command` 문자열을 **고치지 말고 그대로** `<위치>/data/statusline-wrap.json` 에
       `{ "command": "<원래 command>" }` 로 저장한 뒤(`data` 폴더가 없으면 만듭니다), `command` 만
       `node "<위치>/scripts/statusline.mjs" --wrap` 으로 바꿉니다.
       `statusLine` 의 다른 값(padding 등)은 그대로 둡니다. 화면의 상태줄은 전과 같게 나옵니다.
     - 윈도우: **바꾸지 말고 건너뜁니다.** 사용자에게 「쓰고 계신 상태줄이 있어 그대로 두었습니다」라고 알립니다.
  5. 확인: 아래 JSON 을 표준 입력으로 넣어 스크립트를 실행합니다.
     `{"session_id":"tf-install-check","model":{"display_name":"확인"}}`
     - 맥·리눅스: `echo '<위 JSON>' | node "<위치>/scripts/statusline.mjs"`
     - 윈도우(PowerShell): `'<위 JSON>' | node "<위치>/scripts/statusline.mjs"`

     설정 폴더의 `terminal-farm-status/tf-install-check.json` 이 생기면 성공입니다. 확인용 파일은 지웁니다.
  6. 원래 상태줄을 감쌌다면, 클로드 코드를 다시 연 뒤 아래 상태줄이 전과 같은지 사용자에게 확인받습니다.
     다르면 백업(`settings.json.bak-terminal-farm`)으로 되돌립니다.

## 5. 켜고 열기

- 맥: `<위치>/scripts/start.sh` — 서버를 뒤에서 켜고 브라우저로 http://localhost:5274 를 엽니다.
  터미널 창을 닫아도 서버는 계속 돕니다.
- 윈도우·리눅스: `<위치>` 에서 `npm start` 를 실행하고 브라우저로 http://localhost:5274 를 엽니다. 그 창을 닫으면 꺼집니다.
- 지금 **터미널에서 열려 있는 클로드 코드 대화창**이 일꾼이 됩니다. 아무도 안 보이면 설정(S) → 「보여 줄 대화창: 앱 포함 전부」.
- 맥 **Terminal 앱**에서는 [터미널로 가기]·[새 대화]까지 됩니다. 처음 누를 때 맥이 묻는 권한은 허용합니다.

## 6. 끝나면 사용자에게 알려 줄 것

- 켜기: (맥) `<위치>/scripts/start.sh` · (윈도우·리눅스) `<위치>` 에서 `npm start`
- 끄기: (맥) `<위치>/scripts/stop.sh` · (윈도우·리눅스) 그 창 닫기
- 둘러보기: **T** 구조 투어 · **K** 「농장 = 실제」 대응표 · **S** 설정 · **?** 도움말
- 업데이트: `<위치>` 에서 `git pull` 후 `npm install` (ZIP으로 받았다면 다시 받기)
- 지우기: `<위치>` 폴더를 지웁니다. 4단계에서 정보 줄을 켰다면 `settings.json.bak-terminal-farm` 으로 되돌리고,
  설정 폴더의 `terminal-farm-status` 폴더도 지웁니다.

## (원할 때만) 바탕화면 아이콘

기본 설치에서는 만들지 않습니다. 사용자가 원할 때만 만듭니다. 컴퓨터를 켤 때 자동으로 켜는 것은 권하지 않습니다.

- 맥: Terminal 안에서 `start.sh` 를 실행하는 작은 앱을 만듭니다(Terminal 안에서 켜야 [터미널로 가기] 권한이 이어집니다).
  ```bash
  osacompile -o ~/Desktop/터미널\ 농장.app -e 'tell application "Terminal" to do script "exec /bin/zsh -l <위치>/scripts/start.sh"'
  ```
- 윈도우: 바탕화면에 바로 가기를 만들고, 대상에 `cmd /k "cd /d <위치> && npm start"` 를 넣습니다.
