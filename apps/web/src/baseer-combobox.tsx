import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components/Button";
import { ComboBox } from "react-aria-components/ComboBox";
import { Input } from "react-aria-components/Input";
import { Label } from "react-aria-components/Label";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";

import type { BaseerSearchOption } from "./baseer-search-select";

type BaseerComboboxProps = {
  id?: string;
  label: string;
  value: string;
  options: readonly BaseerSearchOption[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  /** Changes only when the owning company/session/query scope changes. */
  scopeKey?: string;
  remoteSearch?: (query: string, signal: AbortSignal) => Promise<readonly BaseerSearchOption[]>;
  loadingLabel: string;
  emptyLabel: string;
  errorLabel: string;
  searchable?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
};

/**
 * The only gateway from Baseer UI to React Aria Combobox. Screens keep the
 * Baseer option/value contract and never import the library directly.
 */
export function BaseerCombobox({ id, label, value, options, placeholder, disabled = false, required = false, scopeKey = "baseer-combobox", remoteSearch, loadingLabel, emptyLabel, errorLabel, searchable = true, className, menuClassName, onChange }: BaseerComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `baseer-combobox-${generatedId}`;
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<readonly BaseerSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const previousScopeKey = useRef(scopeKey);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? remoteOptions.find((option) => option.id === value), [options, remoteOptions, value]);
  const visibleOptions = useMemo(() => {
    const source = remoteSearch ? remoteOptions : options;
    const term = inputValue.trim().toLocaleLowerCase();
    const filtered = remoteSearch ? source : source.filter((option) => !term || option.label.toLocaleLowerCase().includes(term));
    return selected && !filtered.some((option) => option.id === selected.id) ? [selected, ...filtered] : filtered;
  }, [inputValue, options, remoteOptions, remoteSearch, selected]);

  useEffect(() => {
    if (!open || !remoteSearch) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void remoteSearch(inputValue, controller.signal)
        .then((next) => { if (!controller.signal.aborted) setRemoteOptions(next); })
        .catch(() => { if (!controller.signal.aborted) { setRemoteOptions([]); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [inputValue, open, remoteSearch, scopeKey]);

  useEffect(() => {
    if (open) return;
    setInputValue(selected?.label ?? "");
  }, [open, selected]);

  useEffect(() => {
    if (previousScopeKey.current === scopeKey) return;
    previousScopeKey.current = scopeKey;
    setRemoteOptions([]);
    setFailed(false);
    setInputValue("");
    onChange("");
  }, [onChange, scopeKey]);

  return <ComboBox
    className={["baseer-combobox", className].filter(Boolean).join(" ")}
    selectedKey={value || null}
    inputValue={inputValue}
    isDisabled={disabled}
    isRequired={required}
    allowsEmptyCollection
    onInputChange={(next) => { if (searchable) setInputValue(next); }}
    onOpenChange={setOpen}
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
    onSelectionChange={(key) => { if (key !== null) onChange(String(key)); else if (!required) onChange(""); }}
  >
    <Label className="visually-hidden">{label}</Label>
    <div className="baseer-combobox__control">
      <Input id={inputId} className="baseer-combobox__input" placeholder={placeholder} autoComplete="off" readOnly={!searchable} onFocus={() => { if (searchable && inputValue === selected?.label) setInputValue(""); }} />
      <Button className="baseer-combobox__trigger" aria-label={label}>▾</Button>
    </div>
    <Popover className={["baseer-combobox__popover", menuClassName].filter(Boolean).join(" ")} data-baseer-filter-menu-portal="" offset={4}>
      <ListBox className="baseer-combobox__list" renderEmptyState={() => loading ? loadingLabel : failed ? errorLabel : emptyLabel}>
        {visibleOptions.map((option) => <ListBoxItem key={option.id} id={option.id} textValue={option.label} className="baseer-combobox__option">
          <span>{option.label}</span>{option.description ? <small>{option.description}</small> : null}{option.isFavorite ? <span aria-hidden="true">★</span> : null}
        </ListBoxItem>)}
      </ListBox>
    </Popover>
  </ComboBox>;
}
