import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from './supabaseClient';

const initialForm = {
  name: '',
  description: '',
  category: 'Refrigerators',
  price: '',
  stock: ''
};

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const createUniqueFilePath = (file) => {
  const extension = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/png' ? '.png' : file.type === 'image/webp' ? '.webp' : '.gif';
  const uniqueId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `products/${Date.now()}-${uniqueId}${extension}`;
};

export default function ProductEditor({ onSaved }) {
  const [formData, setFormData] = useState(initialForm);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const fileInputRef = useRef(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files ?? []);
    const invalidFile = files.find((file) => !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE_BYTES);

    if (invalidFile) {
      const message = !ALLOWED_IMAGE_TYPES.has(invalidFile.type)
        ? 'Only JPG, PNG, WEBP, and GIF images are allowed.'
        : `${invalidFile.name} is larger than the 10 MB image limit.`;
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError(message);
      toast.error(message);
      return;
    }

    setSelectedFiles(files);
    setError('');
    setSuccessMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccessMessage('');

    if (selectedFiles.length === 0) {
      const message = 'Please select at least one appliance image.';
      setError(message);
      toast.error(message);
      return;
    }

    const price = Number(formData.price);
    const stock = Number(formData.stock);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0) {
      const message = 'Enter a valid non-negative price and whole-number stock quantity.';
      setError(message);
      toast.error(message);
      return;
    }

    setIsSubmitting(true);
    const uploadedPaths = [];

    try {
      const imageUrls = [];

      for (const file of selectedFiles) {
        const uniqueFilePath = createUniqueFilePath(file);
        const { error: uploadError } = await supabase.storage
          .from('Wenappliances')
          .upload(uniqueFilePath, file);

        if (uploadError) throw uploadError;
        uploadedPaths.push(uniqueFilePath);

        const { data: publicUrlData } = supabase.storage
          .from('Wenappliances')
          .getPublicUrl(uniqueFilePath);

        if (!publicUrlData?.publicUrl) throw new Error(`Could not create a public URL for ${file.name}.`);
        imageUrls.push(publicUrlData.publicUrl);
      }

      const { data, error: insertError } = await supabase
        .from('products')
        .insert({
          name: formData.name.trim(),
          description: formData.description.trim(),
          category: formData.category,
          price,
          stock,
          images: imageUrls
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setFormData(initialForm);
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      const message = 'Appliance saved successfully.';
      setSuccessMessage(message);
      toast.success(message);
      onSaved?.(data);
    } catch (submitError) {
      if (uploadedPaths.length > 0) await supabase.storage.from('Wenappliances').remove(uploadedPaths);
      const message = submitError.message || 'Unable to save the appliance.';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="motion-fade-up mx-auto max-w-3xl rounded-2xl border border-[#24272A] bg-[#17191C] p-6 text-[#F1F3EF] shadow-xl sm:p-8" aria-labelledby="product-editor-title">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#9C6644]">Inventory</p>
        <h1 id="product-editor-title" className="mt-2 text-2xl font-bold">Add appliance</h1>
        <p className="mt-2 text-sm text-[#B8BAB7]">Upload product images and save the appliance to Supabase.</p>
      </div>

      {error && <div className="mb-5 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</div>}
      {successMessage && <div className="mb-5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300" role="status">{successMessage}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="product-name" className="mb-2 block text-sm font-semibold">Name</label>
          <input id="product-name" name="name" value={formData.name} onChange={handleChange} required className="w-full rounded-lg border border-[#24272A] bg-[#0B0B0C] px-3 py-2.5 outline-none focus:border-[#9C6644]" />
        </div>

        <div>
          <label htmlFor="product-description" className="mb-2 block text-sm font-semibold">Description</label>
          <textarea id="product-description" name="description" value={formData.description} onChange={handleChange} rows="5" required className="w-full resize-y rounded-lg border border-[#24272A] bg-[#0B0B0C] px-3 py-2.5 outline-none focus:border-[#9C6644]" />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="product-category" className="mb-2 block text-sm font-semibold">Category</label>
            <select id="product-category" name="category" value={formData.category} onChange={handleChange} required className="w-full rounded-lg border border-[#24272A] bg-[#0B0B0C] px-3 py-2.5 outline-none focus:border-[#9C6644]">
              <option>Refrigerators</option><option>Washers</option><option>Dryers</option><option>Ovens</option><option>Microwaves</option><option>Dishwashers</option><option>TVs</option><option>Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="product-price" className="mb-2 block text-sm font-semibold">Price (USD)</label>
            <input id="product-price" name="price" type="number" min="0" step="0.01" value={formData.price} onChange={handleChange} required className="w-full rounded-lg border border-[#24272A] bg-[#0B0B0C] px-3 py-2.5 outline-none focus:border-[#9C6644]" />
          </div>

          <div>
            <label htmlFor="product-stock" className="mb-2 block text-sm font-semibold">Stock</label>
            <input id="product-stock" name="stock" type="number" min="0" step="1" value={formData.stock} onChange={handleChange} required className="w-full rounded-lg border border-[#24272A] bg-[#0B0B0C] px-3 py-2.5 outline-none focus:border-[#9C6644]" />
          </div>
        </div>

        <div>
          <label htmlFor="product-images" className="mb-2 block text-sm font-semibold">Product images</label>
          <input id="product-images" ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileChange} required className="block w-full cursor-pointer rounded-lg border border-[#24272A] bg-[#0B0B0C] text-sm text-[#B8BAB7] file:mr-4 file:border-0 file:bg-[#24272A] file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-[#F1F3EF] hover:file:bg-[#9C6644]" />
          <p className="mt-2 text-xs text-[#858884]">{selectedFiles.length > 0 ? `${selectedFiles.length} image(s) selected` : 'You can select multiple images.'}</p>
        </div>

        <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#9C6644] px-4 py-3 font-bold text-white transition hover:bg-[#8A5A3C] disabled:cursor-not-allowed disabled:opacity-60">
          {isSubmitting && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />}
          {isSubmitting ? 'Uploading images and saving...' : 'Save appliance'}
        </button>
      </form>
    </section>
  );
}
