import { parseDate, type CalendarDate } from "@internationalized/date";
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput, DatePicker, DateSegment, Group, Label, Popover } from "react-aria-components/DatePicker";
import { Dialog } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { I18nProvider } from "react-aria-components/I18nProvider";

import "./baseer-calendar.css";

type Language = "ar" | "en";

type BaseerAriaDatePickerProps = {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  plain?: boolean;
  className?: string;
};

function parseIso(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDate(value) : null;
}

/**
 * Opt-in date pilot: it keeps Baseer's Gregorian YYYY-MM-DD business contract
 * while React Aria owns the keyboard, focus, calendar and popover behavior.
 */
export function BaseerAriaDatePicker({ language, value, onChange, label, min, max, disabled = false, clearable = false, plain = false, className }: BaseerAriaDatePickerProps) {
  // Business dates in Baseer are always Gregorian ISO dates. The locale may
  // change the language and text direction, but never the calendar system.
  // Arabic layout with Latin numeric/date conventions gives the compact month
  // abbreviation used in financial workspaces (for example, "Aug").
  const locale = language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-US-u-ca-gregory";
  const selected = parseIso(value);
  const minValue = parseIso(min);
  const maxValue = parseIso(max);

  return <I18nProvider locale={locale}><DatePicker<CalendarDate>
    aria-label={label}
    className={["baseer-aria-date-picker", plain ? "is-plain" : "", className].filter(Boolean).join(" ")}
    value={selected}
    minValue={minValue}
    maxValue={maxValue}
    isDisabled={disabled}
    shouldCloseOnSelect
    onChange={(date) => { if (date) onChange(date.toString()); }}
  >
    <Label className="visually-hidden">{label}</Label>
    <Group className="baseer-aria-date-picker__group">
      <DateInput className="baseer-aria-date-picker__input" dir="ltr" lang="en">{(segment) => <DateSegment segment={segment} />}</DateInput>
      <Button className="baseer-aria-date-picker__trigger" aria-label={language === "ar" ? "فتح التقويم" : "Open calendar"}>⌄</Button>
      {clearable ? <Button className="baseer-aria-date-picker__clear" isDisabled={disabled || !value} aria-label={language === "ar" ? "مسح التاريخ" : "Clear date"} onPress={() => onChange("")}>×</Button> : null}
    </Group>
    <Popover className="baseer-aria-date-picker__popover" offset={4}>
      <Dialog className="baseer-aria-date-picker__dialog">
        <Calendar className="baseer-aria-date-picker__calendar" aria-label={label}>
          <header className="baseer-aria-date-picker__header">
            <Button slot="previous" className="baseer-aria-date-picker__nav" aria-label={language === "ar" ? "الشهر السابق" : "Previous month"}>{language === "ar" ? "›" : "‹"}</Button>
            <Heading className="baseer-aria-date-picker__heading" />
            <Button slot="next" className="baseer-aria-date-picker__nav" aria-label={language === "ar" ? "الشهر التالي" : "Next month"}>{language === "ar" ? "‹" : "›"}</Button>
          </header>
          <CalendarGrid className="baseer-aria-date-picker__grid" weekdayStyle="short">
            <CalendarGridHeader>{(day) => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader>
            <CalendarGridBody>{(date) => <CalendarCell date={date} />}</CalendarGridBody>
          </CalendarGrid>
        </Calendar>
      </Dialog>
    </Popover>
  </DatePicker></I18nProvider>;
}
