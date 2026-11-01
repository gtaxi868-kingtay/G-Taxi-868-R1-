import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, EmptyState, Screen, Txt } from '../ui/kit';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  public render() {
    if (this.state.hasError) {
      return <CrashScreen error={this.state.error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function CrashScreen({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <Screen footer={<Button title="Try again" onPress={onRetry} />}>
      <EmptyState icon="alert-circle-outline" title="Something went wrong" body="G 868 hit an unexpected problem. Try again, and if it keeps happening, call us on 1-868-703-1000." />
      {__DEV__ && error ? <Txt variant="caption" tone="faint" style={{ textAlign: 'center' }}>{error.toString()}</Txt> : null}
    </Screen>
  );
}
