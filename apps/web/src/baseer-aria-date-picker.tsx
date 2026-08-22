import { parseDate, type CalendarDate } from "@internationalized/date";
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput, DatePicker, DateSegment, Group, Label, Popover } from "react-aria-components/DatePicker";
import { Dialog } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { I18nProvider } from "react-aria-components/I18nProvider";

type Language = "ar" | "en";

type BaseerAriaDatePickerProps = {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
};

function parseIso(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDate(value) : null;
}

/**
 * Opt-in date pilot: it keeps Baseer's Gregorian YYYY-MM-DD business contract
 * while React Aria owns the keyboard, focus, calendar and popover behavior.
 */
export function BaseerAriaDatePicker({ language, value, onChange, label, min, max, disabled = false }: BaseerAriaDatePickerProps) {
  // Business dates in Baseer are always Gregorian ISO dates. The locale may
  // change the language and text direction, but never the calendar system.
  const locale = language === "ar" ? "ar-SA-u-ca-gregory" : "en-US-u-ca-gregory";
  const selected = parseIso(value);
  const minValue = parseIso(min);
  const maxValue = parseIso(max);

  return <I18nProvider locale={locale}><DatePicker<CalendarDate>
    aria-label={label}
    className="baseer-aria-date-picker"
    value={selected}
    minValue={minValue}
    maxValue={maxValue}
    isDisabled={disabled}
    shouldCloseOnSelect
    onChange={(date) => { if (date) onChange(date.toString()); }}
  >
    <Label className="visually-hidden">{label}</Label>
    <Group className="baseer-aria-date-picker__group">
      <DateInput className="baseer-aria-date-picker__input">{(segment) => <DateSegment segment={segment} />}</DateInput>
      <Button className="baseer-aria-date-picker__trigger" aria-label={language === "ar" ? "فتح التقويم" : "Open calendar"}>⌄</Button>
    </Group>
    <Popover className="baseer-aria-date-picker__popover" offset={4}>
      <Dialog className="baseer-aria-date-picker__dialog">
        <Calendar className="baseer-aria-date-picker__calendar" aria-label={label}>
          <header className="baseer-aria-date-picker__header">
            <Button slot="previous" className="baseer-aria-date-picker__nav" aria-label={language === "ar" ? "الشهر السابق" : "Previous month"}>‹</Button>
            <Heading className="baseer-aria-date-picker__heading" />
            <Button slot="next" className="baseer-aria-date-picker__nav" aria-label={language === "ar" ? "الشهر التالي" : "Next month"}>›</Button>
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
