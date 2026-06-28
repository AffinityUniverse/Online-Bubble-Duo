# Online Bubble Monster Duo

방 코드로 접속하는 온라인 2인용 물폭탄 몬스터 게임입니다.

## 파일 구조

```txt
online-bubble-game/
├─ server.js
├─ package.json
├─ .gitignore
├─ README.md
└─ public/
   └─ index.html
```

## 로컬 테스트

터미널에서 아래 순서대로 실행합니다.

```bash
npm install
npm start
```

브라우저에서 아래 주소를 엽니다.

```txt
http://localhost:3000
```

테스트 방법:

1. 브라우저 창 1개에서 방 만들기
2. 방 코드 복사
3. 다른 브라우저 창 또는 다른 컴퓨터에서 같은 주소 접속
4. 방 코드 입력 후 입장
5. 게임 시작 클릭

## GitHub에 업로드하는 방법

1. GitHub에서 새 저장소를 만듭니다.
2. 이 폴더 안의 파일을 구조 그대로 업로드합니다.
3. `server.js`, `package.json`, `public/index.html` 위치가 바뀌면 안 됩니다.

## 배포 주의

GitHub Pages는 정적 HTML/CSS/JS 사이트용입니다.  
이 프로젝트는 WebSocket 서버가 필요하므로 GitHub Pages만으로는 온라인 2인 접속이 되지 않습니다.

추천 방식:

1. GitHub에 이 프로젝트를 업로드
2. Render, Railway 같은 Node.js 실행 가능한 호스팅에 GitHub 저장소 연결
3. Build Command: `npm install`
4. Start Command: `npm start`
5. 배포된 URL을 두 명이 함께 접속

## 조작법

- 이동: WASD 또는 방향키
- 물폭탄: Space
- 키 한 번 = 한 칸 이동
