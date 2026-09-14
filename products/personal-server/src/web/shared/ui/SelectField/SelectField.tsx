import { ChevronDown, Check } from 'lucide-react';
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import styles from './SelectField.module.css';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export function SelectField({ label, value, options, disabled, dataField, dataPath, onChange }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly disabled?: boolean;
  readonly dataField?: string;
  readonly dataPath?: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return <Select className={styles.select} selectedKey={value} isDisabled={disabled} onSelectionChange={(key) => onChange(String(key))}>
    <Label>{label}</Label>
    <Button className={styles.trigger} data-field={dataField} data-path={dataPath}>
      <SelectValue /><ChevronDown aria-hidden="true" size={16} />
    </Button>
    <Popover className={styles.popover} placement="bottom start">
      <ListBox className={styles.list} items={options}>
        {(option) => <ListBoxItem className={styles.option} id={option.value} textValue={option.label}>
          {({ isSelected }) => <><span>{option.label}</span>{isSelected && <Check aria-hidden="true" size={15} />}</>}
        </ListBoxItem>}
      </ListBox>
    </Popover>
  </Select>;
}
