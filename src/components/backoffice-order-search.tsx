"use client";

import {
  useDeferredValue,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

type BackofficeOrderSearchProps = {
  className: string;
  customerNames: string[];
  initialValue: string;
};

export function BackofficeOrderSearch({
  className,
  customerNames,
  initialValue,
}: BackofficeOrderSearchProps) {
  const router = useRouter();
  const listId = useId();
  const timeoutRef = useRef<number | null>(null);
  const [value, setValue] = useState(initialValue);
  const deferredValue = useDeferredValue(value.trim().toLowerCase());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const matchingNames = customerNames
    .filter((name) => !deferredValue || name.toLowerCase().includes(deferredValue))
    .slice(0, 10);

  function updateSearch(nextValue: string) {
    setValue(nextValue);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      const nextParams = new URLSearchParams(window.location.search);
      nextParams.set("tab", "orders");
      nextParams.delete("orderPage");
      if (nextValue.trim()) {
        nextParams.set("orderQuery", nextValue.trim());
      } else {
        nextParams.delete("orderQuery");
      }

      startTransition(() => {
        router.replace(`/backoffice?${nextParams.toString()}`, { scroll: false });
      });
    }, 220);
  }

  return (
    <div className="relative">
      <input
        type="search"
        name="orderQuery"
        list={listId}
        value={value}
        onChange={(event) => updateSearch(event.target.value)}
        placeholder="Start typing a customer name"
        autoComplete="off"
        className={`${className} pr-28`}
        aria-describedby={`${listId}-status`}
      />
      <datalist id={listId}>
        {matchingNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <span
        id={`${listId}-status`}
        className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-slate-400"
        aria-live="polite"
      >
        {isPending ? "Filtering..." : ""}
      </span>
    </div>
  );
}
