import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PersonalServerAppController } from './PersonalServerAppController';
import { PersonalServerRouter } from './router';

const controller = new PersonalServerAppController();

export function PersonalServerApplication(): JSX.Element {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, []);

  return (
    <BrowserRouter>
      {snapshot.session === 'loading' ? (
        <main className="session-loading" data-role="session-loading" aria-live="polite">
          <span className="brand-wordmark">微光摇篮</span>
          <p>正在确认 Personal Server 会话…</p>
        </main>
      ) : snapshot.session === 'anonymous' ? (
        <AuthenticationScreen
          pending={snapshot.loginPending}
          message={snapshot.loginMessage}
          onLogin={(token) => controller.login(token)}
        />
      ) : (
        <PersonalServerRouter controller={controller} snapshot={snapshot} />
      )}
    </BrowserRouter>
  );
}

function AuthenticationScreen(props: {
  readonly pending: boolean;
  readonly message: string;
  readonly onLogin: (token: string) => Promise<void>;
}): JSX.Element {
  const [token, setToken] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submittedToken = token;
    setToken('');
    await props.onLogin(submittedToken);
  };

  return (
    <main className="login-layer" data-role="login-layer">
      <form className="login-panel" data-role="login-form" onSubmit={(event) => void submit(event)}>
        <span className="brand-wordmark">微光摇篮</span>
        <div className="login-heading">
          <span>Personal Server</span>
          <h1>连接你的个人控制面</h1>
          <p>输入部署时生成的访问令牌。登录后会返回当前 URL 对应的工作区。</p>
        </div>
        <input name="username" value="personal-server" autoComplete="username" hidden readOnly />
        <label htmlFor="access-token">访问令牌</label>
        <input
          ref={inputRef}
          id="access-token"
          name="token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.currentTarget.value)}
          disabled={props.pending}
          required
        />
        <button className="primary-button" type="submit" disabled={props.pending}>
          {props.pending ? '正在连接…' : '连接 Personal Server'}
        </button>
        <output data-role="login-message" aria-live="polite">{props.message}</output>
      </form>
    </main>
  );
}
