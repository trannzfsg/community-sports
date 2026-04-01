"use client";

import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import type { PlayerDirectoryEntry } from "@/lib/players";

type PlayerOption = PlayerDirectoryEntry & {
  inputValue?: string;
  label?: string;
};

type Props = {
  players: PlayerDirectoryEntry[];
  disabled?: boolean;
  onSelectOrCreate: (value: { type: "existing"; player: PlayerDirectoryEntry } | { type: "create"; name: string }) => Promise<void> | void;
};

const filter = createFilterOptions<PlayerOption>();

export default function SearchablePlayerSelect({
  players,
  disabled,
  onSelectOrCreate,
}: Props) {
  const options: PlayerOption[] = players.map((player) => ({
    ...player,
    label: `${player.displayName}${player.email ? ` <${player.email}>` : ""}`,
  }));

  return (
    <Autocomplete
      disabled={disabled}
      options={options}
      fullWidth
      clearOnBlur
      selectOnFocus
      handleHomeEndKeys
      getOptionLabel={(option) => {
        if (typeof option === "string") return option;
        if (option.inputValue) return option.inputValue;
        return option.label || option.displayName;
      }}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      filterOptions={(filteredOptions, params) => {
        const result = filter(filteredOptions, params);
        const { inputValue } = params;
        const isExisting = filteredOptions.some((option) => {
          const label = `${option.displayName}${option.email ? ` <${option.email}>` : ""}`;
          return label.toLowerCase() === inputValue.toLowerCase() || option.displayName.toLowerCase() === inputValue.toLowerCase();
        });

        if (inputValue !== "" && !isExisting) {
          result.push({
            id: `create:${inputValue}`,
            ownerOrganiserId: null,
            userId: null,
            displayName: inputValue,
            email: "",
            source: "manual",
            inputValue,
            label: `Create "${inputValue}"`,
          });
        }

        return result;
      }}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        return (
          <li key={key} {...rest}>
            <span className="truncate">{option.inputValue ? `Create "${option.inputValue}"` : `${option.displayName}${option.email ? ` <${option.email}>` : ""}`}</span>
          </li>
        );
      }}
      onChange={async (_, newValue) => {
        if (!newValue || typeof newValue === "string") return;

        if (newValue.inputValue) {
          await onSelectOrCreate({ type: "create", name: newValue.inputValue });
          return;
        }

        await onSelectOrCreate({ type: "existing", player: newValue });
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search or create player"
          size="small"
        />
      )}
    />
  );
}
