'use client';
import { useEffect, useState, useId } from 'react';

export function ProductImageUpload({
  existing,
  required,
  label = 'Product photo',
}: {
  existing?: string;
  required: boolean;
  label?: string;
}) {
  const helpId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        aria-describedby={helpId}
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required={required}
        onChange={(event) => {
          const input = event.currentTarget;
          const selected = input.files?.[0];
          input.setCustomValidity(
            selected && selected.size > 3 * 1024 * 1024
              ? 'Choose an image smaller than 3 MB.'
              : '',
          );
          setFile(selected ?? null);
        }}
      />
      <small id={helpId}>
        Upload a JPEG, PNG or WebP, up to 3 MB. Your uploaded image will be used
        in this section.
      </small>
      {(preview || existing) && (
        <img
          className="upload-preview"
          src={preview || existing}
          alt="Product photo preview"
        />
      )}
    </label>
  );
}
