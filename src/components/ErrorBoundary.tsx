// 렌더 예외의 마지막 방어선 — 깨진 원격 문서 1건(형식 오류)이 화면 전체를 백지로 만들던 경로 차단
// (2026-09-02 점검 C5). 원인은 고치지 않고 "무엇을 하면 되는지"만 안내한다.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[MJC-READY] 화면 렌더 오류", error, info.componentStack);
  }

  // 다른 화면(해시 라우트)으로 이동하면 오류 상태를 풀어 준다 — 예전엔 한 번 깨지면 새로고침 전까지
  // 모든 라우트가 오류 화면이었다 (점검 낮음)
  private onHashChange = () => {
    if (this.state.error) this.setState({ error: null });
  };
  componentDidMount(): void {
    window.addEventListener("hashchange", this.onHashChange);
  }
  componentWillUnmount(): void {
    window.removeEventListener("hashchange", this.onHashChange);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <main className="container">
          <section className="card empty-card">
            <h2>화면을 표시하는 중 문제가 생겼습니다</h2>
            <p className="muted">
              입력한 내용은 대부분 브라우저에 남아 있습니다. 새로고침으로 다시 열어 보고, 계속 반복되면
              잡카페(본관 1층) 또는 학생지원처 취·창업팀에 알려 주세요.
            </p>
            <p className="muted small">{this.state.error.message}</p>
            <div className="actions">
              <button className="btn btn--primary" onClick={() => window.location.reload()}>
                새로고침
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  window.location.hash = "#/";
                  window.location.reload();
                }}
              >
                시작 화면으로
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }
}
