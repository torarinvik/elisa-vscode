Paragraph with `enum Event` stays Markdown text.

```elisa
enum Event:
    Resize(size: i32)

def make_event() -> Event:
    return Event.Resize(1)
````

The prose after the fence has Event.Resize and return, but is still Markdown.

~~~ELISA linenos
struct Vec2:
    x: f32
~~~

```python
def not_elisa():
    return Event.Resize(1)
```

```elisa-not-a-language
not Elisa code
```
