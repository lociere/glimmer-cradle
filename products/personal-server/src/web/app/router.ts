export type AppRoute = 'conversation' | 'status' | 'extensions' | 'logs' | 'settings';

export class AppRouter {
  private currentRoute: AppRoute = 'conversation';
  private readonly listeners = new Set<(route: AppRoute) => void>();

  public get route(): AppRoute {
    return this.currentRoute;
  }

  public navigate(route: AppRoute): void {
    if (this.currentRoute === route) return;
    this.currentRoute = route;
    for (const listener of this.listeners) listener(route);
  }

  public subscribe(listener: (route: AppRoute) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentRoute);
    return () => this.listeners.delete(listener);
  }
}
