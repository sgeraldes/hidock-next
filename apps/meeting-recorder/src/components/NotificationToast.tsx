import { useEffect, useState } from "react";

export type NotificationType = "error" | "warning" | "success" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

function NotificationToast({ notification, onDismiss }: NotificationToastProps) {
  const { id, type, message, duration = 5000 } = notification;

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, onDismiss]);

  const typeStyles = {
    error: "bg-red-900/90 border-red-500 text-red-100",
    warning: "bg-yellow-900/90 border-yellow-500 text-yellow-100",
    success: "bg-green-900/90 border-green-500 text-green-100",
    info: "bg-blue-900/90 border-blue-500 text-blue-100",
  };

  const icons = {
    error: "❌",
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg ${typeStyles[type]} animate-slide-in-right`}
      role="alert"
    >
      <span className="text-lg">{icons[type]}</span>
      <p className="flex-1 text-sm">{message}</p>
      <button
        onClick={() => onDismiss(id)}
        className="text-current opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
}

export function NotificationContainer() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    // Listen for notification events from anywhere in the app
    const handleNotification = (event: CustomEvent<Notification>) => {
      setNotifications((prev) => [...prev, event.detail]);
    };

    window.addEventListener(
      "app:notification" as any,
      handleNotification as EventListener,
    );
    return () => {
      window.removeEventListener(
        "app:notification" as any,
        handleNotification as EventListener,
      );
    };
  }, []);

  const handleDismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}

// Utility function to show notifications from anywhere
export function showNotification(
  type: NotificationType,
  message: string,
  duration?: number,
) {
  const notification: Notification = {
    id: `${Date.now()}-${Math.random()}`,
    type,
    message,
    duration,
  };

  window.dispatchEvent(
    new CustomEvent("app:notification", { detail: notification }),
  );
}
