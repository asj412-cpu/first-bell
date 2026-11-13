export default function GiftItemFields({ items, errors, onChange, onAdd, onRemove }) {
  return (
    <div className="item-rows">
      {items.map((item, index) => (
        <fieldset key={item.key} className="other-person">
          <legend>Item {index + 1}</legend>
          <label className="field">
            <span>Description</span>
            <input
              value={item.description}
              maxLength={160}
              placeholder={index === 0 ? 'Wool scarf' : 'Another idea'}
              onChange={(event) => onChange(index, { description: event.target.value })}
            />
          </label>
          {errors?.[`item-${index}`] && <p className="form-error">{errors[`item-${index}`]}</p>}
          <label className="field">
            <span>Link, if you have one</span>
            <input
              value={item.url}
              inputMode="url"
              autoComplete="url"
              placeholder="https://"
              onChange={(event) => onChange(index, { url: event.target.value })}
            />
          </label>
          {errors?.[`url-${index}`] && <p className="form-error">{errors[`url-${index}`]}</p>}
          <button className="btn small ghost" type="button" onClick={() => onRemove(index)}>
            Remove
          </button>
        </fieldset>
      ))}
      {errors?.items && <p className="form-error">{errors.items}</p>}
      <button className="btn" type="button" onClick={onAdd}>
        Add another item
      </button>
    </div>
  )
}
