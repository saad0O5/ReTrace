import { Component } from 'react';

/**
 * React Error Boundary — wraps individual pages so a crash in one page
 * doesn't take down the entire app. Shows a recovery UI with retry.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <div className="error-boundary-icon">!</div>
          <div className="error-boundary-title">Something went wrong</div>
          <div className="error-boundary-desc">
            {this.state.error?.message || 'An unexpected error occurred in this section.'}
          </div>
          <button className="btn btn-secondary" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
