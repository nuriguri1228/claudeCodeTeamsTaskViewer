# ccteams

Claude Code의 팀 태스크를 GitHub Issues + Projects V2 칸반 보드로 자동 동기화하는 CLI 도구.

## 주요 기능

- Claude Code 세션의 태스크를 **실제 GitHub Issue**로 생성 (Draft Issue 아님)
- GitHub **Projects V2**에 자동 등록, 커스텀 필드(Status, Agent, Team 등) 설정
- `blockedBy` 관계를 **sub-issue** (parent-child)로 매핑
- 팀별 **Label** 자동 생성 (`ccteams:<teamName>`)
- **Agent (Owner)** 필드를 Single Select로 관리 — Board View에서 Group By 가능
- 태스크 변경 감지 시 자동 업데이트, 삭제 시 Issue close + archive
- Claude Code **Hooks** 연동으로 태스크 생성/수정 시 자동 sync

## 전제 조건

- [GitHub CLI (`gh`)](https://cli.github.com/) 설치 및 인증
- `project` scope 추가: `gh auth refresh -s project`
- Node.js 20+

## 설치

```bash
# 저장소 클론
git clone https://github.com/nuriguri1228/claudeCodeTeamsTaskViewer.git
cd claudeCodeTeamsTaskViewer

# 의존성 설치 및 빌드
npm install
npm run build

# 글로벌 링크 (어디서든 ccteams 명령 사용)
npm link
```

## 다른 프로젝트에서 사용하기

ccteams는 **프로젝트 디렉터리 단위**로 동작합니다. 다른 프로젝트에서 사용하려면:

### 1. 해당 프로젝트 디렉터리로 이동

```bash
cd /path/to/my-project
```

### 2. 초기화 (GitHub Project 생성 + Repo 연결)

```bash
ccteams init --repo <owner/repo>

# 예시
ccteams init --repo myorg/my-project
ccteams init --repo myorg/my-project --title "My Project Board"
ccteams init --repo myorg/my-project --owner myorg  # org 소유 프로젝트
```

이 명령은:
- GitHub Projects V2를 생성하고 해당 repository에 연결
- 커스텀 필드(Team Name, Agent (Owner), Task ID, Blocked By, Active Form) 생성
- `.ccteams-sync.json` 파일을 현재 디렉터리에 저장 (`.gitignore`에 추가 권장)

### 3. 태스크 동기화

```bash
# 모든 팀의 태스크를 동기화
ccteams sync

# 특정 팀만 동기화
ccteams sync --team my-team

# 변경 사항 미리보기 (실제 반영 없음)
ccteams sync --dry-run
```

### 4. 자동 동기화 설정 (선택)

**방법 A: 파일 감시 모드**

```bash
ccteams watch                    # 모든 팀 감시
ccteams watch --team my-team     # 특정 팀만
ccteams watch --debounce 2000    # debounce 간격 조정 (ms)
```

**방법 B: Claude Code Hooks (권장)**

Claude Code가 태스크를 생성/수정할 때마다 자동으로 sync 실행:

```bash
ccteams hooks install            # 글로벌 설정에 hook 추가
ccteams hooks install --local    # 프로젝트별 로컬 설정에 추가
```

Hook이 설치되면 Claude Code에서 `TaskCreate`/`TaskUpdate` 실행 시 자동으로 `ccteams sync --quiet`가 동작합니다.

### 간편 실행 (init + sync 자동)

```bash
# 프로젝트 디렉터리에서 인수 없이 실행하면 자동으로:
# 1. git remote에서 owner/repo 감지
# 2. 팀 이름 기반으로 프로젝트 생성
# 3. 즉시 sync 실행
ccteams
```

이미 `.ccteams-sync.json`이 있으면 바로 sync만 실행합니다.

### 5. 프로젝트 종료 / 삭제

**작업 완료 시 — `close`** (프로젝트 보존):

```bash
ccteams close          # 확인 후 종료
ccteams close --force  # 확인 없이 바로 종료
```

- 추적 중인 모든 Issue를 close
- GitHub Project를 closed 상태로 변경 (GitHub에 보존됨)
- `.ccteams-sync.json` 파일을 제거

**잘못 생성했을 때 — `reset`** (프로젝트 삭제):

```bash
ccteams reset          # 확인 후 삭제
ccteams reset --force  # 확인 없이 바로 삭제
```

- 추적 중인 모든 Issue를 close
- GitHub Project를 **완전 삭제**
- `.ccteams-sync.json` 파일을 제거

### 6. 칸반 보드 설정 (GitHub 웹에서)

GitHub API 제한으로 Board View 생성은 수동으로 해야 합니다:

1. `ccteams init` 출력의 Project URL을 열기
2. View 탭 옆 **+** 클릭 > **Board** 선택
3. **Group by** > **Agent (Owner)** 선택 (agent별 컬럼 분류)
4. **Filter** > Label `ccteams:<team>` 으로 팀별 필터링

## 명령어 요약

| 명령어 | 설명 |
|--------|------|
| `ccteams` | 자동 init + sync (sync state 있으면 바로 sync) |
| `ccteams init --repo <owner/repo>` | 프로젝트 초기화 + repo 연결 |
| `ccteams sync` | 태스크 → GitHub Issue 동기화 |
| `ccteams sync --team <name>` | 특정 팀만 동기화 |
| `ccteams sync --dry-run` | 변경 사항 미리보기 |
| `ccteams watch` | 파일 변경 감시 + 자동 동기화 |
| `ccteams hooks install` | Claude Code hook 설치 |
| `ccteams hooks uninstall` | Claude Code hook 제거 |
| `ccteams status` | 현재 동기화 상태 출력 |
| `ccteams close` | 이슈 닫기 + 프로젝트 종료 (보존) |
| `ccteams close --force` | 확인 없이 바로 종료 |
| `ccteams reset` | 이슈 닫기 + 프로젝트 삭제 |
| `ccteams reset --force` | 확인 없이 바로 삭제 |

## 동기화 동작 방식

```
~/.claude/tasks/<teamName>/*.json   ──sync──>   GitHub Issues + Project V2
```

| 태스크 상태 | GitHub 동작 |
|------------|-------------|
| 새 태스크 발견 | Issue 생성 + Project에 추가 + Label 부착 + 필드 설정 |
| 태스크 변경 | Issue 제목/본문 업데이트 + 필드 업데이트 |
| 태스크 삭제 | Issue close + Project item archive |

### Sub-issue 매핑

태스크의 `blockedBy` 관계가 GitHub sub-issue(parent-child)로 자동 변환됩니다:

- 태스크 A가 `blockedBy: ["B"]`이면 → A의 parent = B
- 의존성 순서로 정렬하여 parent가 먼저 생성됨
- `blockedBy`에 여러 태스크가 있으면 첫 번째만 parent로 설정 (GitHub 제한)

## 프로젝트 구조

```
src/
  index.ts              # CLI 엔트리포인트 (Commander.js)
  constants.ts          # 설정 상수 (필드 정의, 상태 매핑)
  types/
    claude.ts           # Claude Code 태스크 타입
    github.ts           # GitHub API 응답 타입
    sync.ts             # 동기화 상태 타입
  core/
    claude-reader.ts    # ~/.claude/tasks/ 에서 태스크 읽기
    github-project.ts   # GitHub GraphQL API 클라이언트
    sync-engine.ts      # 핵심 동기화 알고리즘
    sync-state.ts       # .ccteams-sync.json 관리
    field-mapper.ts     # 태스크 → GitHub 필드 매핑
  commands/
    auto.ts             # ccteams (기본 명령 — auto-init + sync)
    init.ts             # ccteams init
    sync.ts             # ccteams sync
    watch.ts            # ccteams watch
    hooks.ts            # ccteams hooks install/uninstall
    status.ts           # ccteams status
    close.ts            # ccteams close (프로젝트 종료)
    reset.ts            # ccteams reset (프로젝트 삭제)
  utils/
    gh-auth.ts          # gh CLI 인증 + GraphQL 실행
    git.ts              # git remote URL 파싱
    lock.ts             # 파일 기반 동시 실행 방지
    logger.ts           # 컬러 로깅
    paths.ts            # 경로 헬퍼
    retry.ts            # 지수 백오프 재시도
```

## 개발

```bash
npm run build          # TypeScript 빌드
npm run dev            # watch 모드 빌드
npm test               # 테스트 실행
npm run test:watch     # watch 모드 테스트
```

## 라이선스

MIT
