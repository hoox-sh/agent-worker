#!/bin/bash
# Fix imports in nested directories
find src/ -name "*.ts" -type f | while read file; do
  # Count how many levels deep the file is
  depth=$(echo "$file" | grep -o "/" | wc -l)
  prefix=""
  for ((i=0; i<depth-1; i++)); do
    prefix="../$prefix"
  done
  
  # Fix type imports
  sed -i "s|from '../../../packages/|from '${prefix}packages/|g" "$file"
  # Fix middleware imports  
  sed -i "s|from '../../../packages/|from '${prefix}packages/|g" "$file"
done
echo "Imports fixed"
